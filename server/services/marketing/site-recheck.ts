import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
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
 * - `dns` / `meta` / `file` sites: re-checked when `verificationCheckedAt` is
 *   older than 30 days (rows that predate the column fall back to
 *   `verifiedAt`). A failure increments `verificationFailures` and retries a day
 *   later; the second consecutive failure unverifies the site. Success resets
 *   the counter. `lastVerificationError` only carries a human message.
 */

export const DOMAIN_LOST_MESSAGE = 'The custom domain that verified this site is no longer active — verify again'
export const RECHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
/** After a first failure the retry comes a day later, not a month later */
export const RECHECK_RETRY_MS = 24 * 60 * 60 * 1000
export const RECHECK_MAX_FAILURES = 2
const BATCH = 100
/** Wall-clock budget for the token rechecks of one run; leftovers are picked up next run (oldest check first) */
export const RECHECK_TIME_BUDGET_MS = 2 * 60 * 1000

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
  /** Active domain hostnames per project, for all given projects in one query */
  activeDomains(projectIds: string[]): Promise<Map<string, string[]>>
  /** Monotonic-ish clock in ms for the time budget */
  clock: () => number
  timeBudgetMs: number
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
      .where(and(isNotNull(marketingSite.verifiedAt), eq(marketingSite.verificationMethod, 'domain'))),
  listDueSites: (now, limit) => {
    const lastCheck = sql`coalesce(${marketingSite.verificationCheckedAt}, ${marketingSite.verifiedAt})`
    const monthAgo = new Date(now.getTime() - RECHECK_INTERVAL_MS)
    const dayAgo = new Date(now.getTime() - RECHECK_RETRY_MS)
    return db
      .select(siteColumns)
      .from(marketingSite)
      .where(
        and(
          isNotNull(marketingSite.verifiedAt),
          isNotNull(marketingSite.verificationMethod),
          ne(marketingSite.verificationMethod, 'domain'),
          sql`(case when ${marketingSite.verificationFailures} > 0 then ${lastCheck} < ${dayAgo} else ${lastCheck} < ${monthAgo} end)`
        )
      )
      .orderBy(lastCheck)
      .limit(limit)
  },
  async activeDomains(projectIds) {
    const byProject = new Map<string, string[]>()
    if (projectIds.length === 0) return byProject
    const rows = await db
      .select({ projectId: projectDomain.projectId, hostname: projectDomain.hostname })
      .from(projectDomain)
      .where(and(inArray(projectDomain.projectId, projectIds), eq(projectDomain.status, 'active')))
    for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.hostname])
    return byProject
  },
  clock: () => Date.now(),
  timeBudgetMs: RECHECK_TIME_BUDGET_MS,
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

  const domainSites = await deps.listDomainSites()
  let domainsByProject: Map<string, string[]> | null = null
  try {
    domainsByProject = await deps.activeDomains([...new Set(domainSites.map((site) => site.projectId))])
  } catch {
    // Without the domain list nothing can be judged; retried next hour
  }
  for (const site of domainsByProject ? domainSites : []) {
    try {
      const domains = domainsByProject?.get(site.projectId) ?? []
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
  const startedAt = deps.clock()
  for (const site of due) {
    if (deps.clock() - startedAt > deps.timeBudgetMs) break
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
