/**
 * Forwards this calendar month (UTC) for a workspace, from Frogmail's domain usage totals over the workspace's
 * receiving domains. No schema holds the count, so it lives in a short-TTL in-process cache: filled by the hourly
 * `mail:forward-usage` pass and refreshed on demand (60 s) when the Email tab asks. Each instance computes its own
 * copy; the number is always derived from Frogmail, never accumulated locally.
 */
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { projectMailDomain } from '~/server/database/schema/support'
import { getSendingDomainProvider, type SendingDomainProvider } from '~/server/services/sending-domains'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('mail-forward-count')

export const FORWARD_COUNT_TTL_MS = 60_000

const cache = new Map<string, { count: number; at: number }>()

export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function monthRangeUtc(now: Date = new Date()): { from: string; to: string } {
  return { from: `${now.toISOString().slice(0, 7)}-01`, to: utcDateString(now) }
}

export function setCachedForwardCount(organizationId: string, count: number, now: number = Date.now()) {
  cache.set(organizationId, { count, at: now })
}

export function clearForwardCountCache() {
  cache.clear()
}

/** Receiving domains (`receiving_status` set and not `disabled`) of every project in the workspace. */
export async function listReceivingDomains(organizationId: string) {
  return db
    .select({
      id: projectMailDomain.id,
      domain: projectMailDomain.domain,
      forwardingPausedAt: projectMailDomain.forwardingPausedAt,
    })
    .from(projectMailDomain)
    .innerJoin(project, eq(project.id, projectMailDomain.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        isNotNull(projectMailDomain.receivingStatus),
        ne(projectMailDomain.receivingStatus, 'disabled'),
        ne(projectMailDomain.status, 'deleting')
      )
    )
}

export async function fetchForwardCount(
  provider: SendingDomainProvider,
  domains: string[],
  now: Date = new Date()
): Promise<number> {
  if (domains.length === 0) return 0
  const totals = await provider.getDomainUsage!({ domains, ...monthRangeUtc(now) })
  return totals.forwarded
}

/**
 * The workspace's forwards this month: cached for 60 s, else asked from Frogmail. Null when forwarding is off
 * or Frogmail cannot say (then the last known value, if any, is returned).
 */
export async function getForwardsThisMonth(
  organizationId: string,
  options: { fresh?: boolean; now?: number } = {}
): Promise<number | null> {
  const now = options.now ?? Date.now()
  const cached = cache.get(organizationId)
  if (cached && (options.fresh === false || now - cached.at < FORWARD_COUNT_TTL_MS)) return cached.count
  if (options.fresh === false) return null

  const provider = getSendingDomainProvider()
  if (!provider?.capabilities.forwarding || !provider.getDomainUsage) return null

  try {
    const domains = (await listReceivingDomains(organizationId)).map((row) => row.domain)
    const count = await fetchForwardCount(provider, domains, new Date(now))
    setCachedForwardCount(organizationId, count, now)
    return count
  } catch (error) {
    logger.warn('Could not read forward usage', {
      organizationId,
      error: error instanceof Error ? error.message : error,
    })
    return cached?.count ?? null
  }
}
