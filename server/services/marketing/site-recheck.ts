import { and, eq, isNotNull, lt, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingSite } from '~/server/database/schema/marketing'
import { projectDomain } from '~/server/database/schema/feedback'
import {
  checkVerification,
  isCoveredByVerifiedDomain,
  type VerificationMethod,
} from '~/server/services/marketing/site-verification'

/**
 * Re-checks that verified sites still prove ownership.
 *
 * - `domain` sites: verified through an active project domain. Re-checked on
 *   every run (cheap, DB only); unverified as soon as that domain is gone.
 * - `dns` / `meta` / `file` sites: re-checked at most monthly. Two consecutive
 *   failures unverify the site. There is no schema column for the failure
 *   count, so a failed re-check is recorded in `lastVerificationError` as
 *   `Re-check failed (1/2): ...`, and `updatedAt` doubles as "last checked at".
 */

export const DOMAIN_LOST_MESSAGE = 'The custom domain that verified this site is no longer active — verify again'
export const RECHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
/** After a first failure the retry comes a day later, not a month later */
export const RECHECK_RETRY_MS = 24 * 60 * 60 * 1000
export const RECHECK_FAILURE_PREFIX = 'Re-check failed (1/2): '
const BATCH = 100

export interface RecheckSite {
  id: string
  projectId: string
  origin: string
  verificationToken: string
  verificationMethod: string | null
  lastVerificationError: string | null
}

export interface RecheckDeps {
  now: () => Date
  listDomainSites(): Promise<RecheckSite[]>
  listDueSites(olderThan: Date, limit: number): Promise<RecheckSite[]>
  activeDomains(projectId: string): Promise<string[]>
  check: typeof checkVerification
  update(
    siteId: string,
    patch: { verifiedAt?: null; lastVerificationError: string | null; updatedAt: Date }
  ): Promise<void>
}

const siteColumns = {
  id: marketingSite.id,
  projectId: marketingSite.projectId,
  origin: marketingSite.origin,
  verificationToken: marketingSite.verificationToken,
  verificationMethod: marketingSite.verificationMethod,
  lastVerificationError: marketingSite.lastVerificationError,
}

const defaultDeps: RecheckDeps = {
  now: () => new Date(),
  listDomainSites: () =>
    db
      .select(siteColumns)
      .from(marketingSite)
      .where(and(isNotNull(marketingSite.verifiedAt), eq(marketingSite.verificationMethod, 'domain'))),
  listDueSites: (olderThan, limit) =>
    db
      .select(siteColumns)
      .from(marketingSite)
      .where(
        and(
          isNotNull(marketingSite.verifiedAt),
          isNotNull(marketingSite.verificationMethod),
          ne(marketingSite.verificationMethod, 'domain'),
          lt(marketingSite.updatedAt, olderThan)
        )
      )
      .orderBy(marketingSite.updatedAt)
      .limit(limit),
  async activeDomains(projectId) {
    const rows = await db
      .select({ hostname: projectDomain.hostname })
      .from(projectDomain)
      .where(and(eq(projectDomain.projectId, projectId), eq(projectDomain.status, 'active')))
    return rows.map((r) => r.hostname)
  },
  check: checkVerification,
  async update(siteId, patch) {
    await db.update(marketingSite).set(patch).where(eq(marketingSite.id, siteId))
  },
}

export async function recheckVerifiedSites(
  partial?: Partial<RecheckDeps>
): Promise<{ unverified: number; checked: number }> {
  const deps = { ...defaultDeps, ...partial }
  const now = deps.now()
  let unverified = 0
  let checked = 0

  for (const site of await deps.listDomainSites()) {
    try {
      const domains = await deps.activeDomains(site.projectId)
      if (isCoveredByVerifiedDomain(site.origin, domains)) continue
      await deps.update(site.id, { verifiedAt: null, lastVerificationError: DOMAIN_LOST_MESSAGE, updatedAt: now })
      unverified++
    } catch {
      // One bad row must not stop the sweep; it is retried next hour
    }
  }

  const due = await deps.listDueSites(new Date(now.getTime() - RECHECK_INTERVAL_MS), BATCH)
  for (const site of due) {
    try {
      const method = site.verificationMethod as VerificationMethod
      const result = await deps.check(site.origin, site.verificationToken, method)
      checked++
      if (result.verified) {
        await deps.update(site.id, { lastVerificationError: null, updatedAt: now })
      } else if (site.lastVerificationError?.startsWith(RECHECK_FAILURE_PREFIX)) {
        await deps.update(site.id, {
          verifiedAt: null,
          lastVerificationError: `Verification lapsed: ${result.detail}. Verify again`,
          updatedAt: now,
        })
        unverified++
      } else {
        await deps.update(site.id, {
          lastVerificationError: `${RECHECK_FAILURE_PREFIX}${result.detail}`,
          // Back-dated so the single retry is due in a day rather than a month
          updatedAt: new Date(now.getTime() - RECHECK_INTERVAL_MS + RECHECK_RETRY_MS),
        })
      }
    } catch {
      // Retried on the next run
    }
  }
  return { unverified, checked }
}
