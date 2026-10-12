import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingSite } from '~/server/database/schema/marketing'
import { project, projectDomain } from '~/server/database/schema/feedback'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES } from '~/lib/modules'
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
 * - `dns` / `meta` / `file` sites: re-checked when `verificationCheckedAt` is
 *   older than 30 days (rows that predate the column fall back to
 *   `verifiedAt`). A failure increments `verificationFailures` and retries a day
 *   later; the second consecutive failure unverifies the site. Success resets
 *   the counter. `lastVerificationError` only carries a human message.
 */

/**
 * Sites are only re-checked while Marketing is on for both the team and the product: a switched-off module
 * must not keep probing the site's DNS or pages. Re-enabling resumes the checks.
 */
const marketingOn = and(
  sql`coalesce(${teamModuleSettings.marketingEnabled}, ${DEFAULT_TEAM_MODULES.marketingEnabled})`,
  sql`${project.settings}->>'marketingEnabled' = 'true'`
)

export const DOMAIN_LOST_MESSAGE = 'The custom domain that verified this site is no longer active — verify again'
export const RECHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
/** After a first failure the retry comes a day later, not a month later */
export const RECHECK_RETRY_MS = 24 * 60 * 60 * 1000
export const RECHECK_MAX_FAILURES = 2
const BATCH = 100

export interface RecheckSite {
  id: string
  projectId: string
  origin: string
  verificationToken: string
  verificationMethod: string | null
  lastVerificationError: string | null
  verifiedAt: Date | null
  verificationCheckedAt: Date | null
  verificationFailures: number
}

/** Pure twin of the SQL filter in `listDueSites`. */
export function isRecheckDue(site: RecheckSite, now: Date): boolean {
  const last = site.verificationCheckedAt ?? site.verifiedAt
  if (!last) return false
  const interval = site.verificationFailures > 0 ? RECHECK_RETRY_MS : RECHECK_INTERVAL_MS
  return now.getTime() - last.getTime() > interval
}

export interface RecheckDeps {
  now: () => Date
  listDomainSites(): Promise<RecheckSite[]>
  listDueSites(now: Date, limit: number): Promise<RecheckSite[]>
  activeDomains(projectId: string): Promise<string[]>
  check: typeof checkVerification
  update(
    siteId: string,
    patch: {
      verifiedAt?: null
      lastVerificationError: string | null
      verificationCheckedAt: Date
      verificationFailures: number
    }
  ): Promise<void>
}

const siteColumns = {
  id: marketingSite.id,
  projectId: marketingSite.projectId,
  origin: marketingSite.origin,
  verificationToken: marketingSite.verificationToken,
  verificationMethod: marketingSite.verificationMethod,
  lastVerificationError: marketingSite.lastVerificationError,
  verifiedAt: marketingSite.verifiedAt,
  verificationCheckedAt: marketingSite.verificationCheckedAt,
  verificationFailures: marketingSite.verificationFailures,
}

const defaultDeps: RecheckDeps = {
  now: () => new Date(),
  listDomainSites: () =>
    db
      .select(siteColumns)
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
      .where(and(isNotNull(marketingSite.verifiedAt), eq(marketingSite.verificationMethod, 'domain'), marketingOn)),
  listDueSites: (now, limit) => {
    const lastCheck = sql`coalesce(${marketingSite.verificationCheckedAt}, ${marketingSite.verifiedAt})`
    const monthAgo = new Date(now.getTime() - RECHECK_INTERVAL_MS)
    const dayAgo = new Date(now.getTime() - RECHECK_RETRY_MS)
    return db
      .select(siteColumns)
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
      .where(
        and(
          marketingOn,
          isNotNull(marketingSite.verifiedAt),
          isNotNull(marketingSite.verificationMethod),
          ne(marketingSite.verificationMethod, 'domain'),
          sql`(case when ${marketingSite.verificationFailures} > 0 then ${lastCheck} < ${dayAgo} else ${lastCheck} < ${monthAgo} end)`
        )
      )
      .orderBy(lastCheck)
      .limit(limit)
  },
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
      await deps.update(site.id, {
        verifiedAt: null,
        lastVerificationError: DOMAIN_LOST_MESSAGE,
        verificationCheckedAt: now,
        verificationFailures: 0,
      })
      unverified++
    } catch {
      // One bad row must not stop the sweep; it is retried next hour
    }
  }

  const due = (await deps.listDueSites(now, BATCH)).filter((site) => isRecheckDue(site, now))
  for (const site of due) {
    try {
      const method = site.verificationMethod as VerificationMethod
      const result = await deps.check(site.origin, site.verificationToken, method)
      checked++
      if (result.verified) {
        await deps.update(site.id, {
          lastVerificationError: null,
          verificationCheckedAt: now,
          verificationFailures: 0,
        })
      } else if (site.verificationFailures + 1 >= RECHECK_MAX_FAILURES) {
        await deps.update(site.id, {
          verifiedAt: null,
          lastVerificationError: `Verification lapsed: ${result.detail}. Verify again`,
          verificationCheckedAt: now,
          verificationFailures: site.verificationFailures + 1,
        })
        unverified++
      } else {
        await deps.update(site.id, {
          lastVerificationError: `Re-check failed: ${result.detail}`,
          verificationCheckedAt: now,
          verificationFailures: site.verificationFailures + 1,
        })
      }
    } catch {
      // Retried on the next run
    }
  }
  return { unverified, checked }
}
