/**
 * @openapi
 * /api/marketing/projects/{projectId}/search/summary:
 *   get:
 *     tags: [Marketing]
 *     summary: Search Console clicks, impressions, CTR, position and top queries
 *     description: >
 *       Totals cover the last `days` ending at the latest synced date and the same number of days
 *       before it (`previous` is null when there is no earlier data). CTR is clicks divided by
 *       impressions and position is weighted by impressions. `topQueries` is the latest 28-day
 *       snapshot, top 50 by clicks. Stored history is about 90 days, so `days` is capped at 45.
 *     operationId: getSearchSummary
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: days
 *         schema: { type: integer, minimum: 7, maximum: 45, default: 28 }
 *     responses:
 *       200: { description: Summary; `connection` is null when Search Console is not connected }
 *       403: { description: Marketing is not enabled or no team access }
 */
import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { gscDailyMetric, gscQueryStat } from '~/server/database/schema/marketing'
import { getGoogleRedirectUri } from '~/server/services/google/search-console'
import { findGscConnection, isGscConfigured } from '~/server/services/marketing/search/connection'
import { computeTotals, shiftDate, splitPeriods } from '~/server/services/marketing/search/summary'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { findMarketingSite, isMarketingAdminOf, requireRouteParam } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

const DEFAULT_DAYS = 28
const MIN_DAYS = 7
const MAX_DAYS = 45
const TOP_QUERIES = 50

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { organizationId } = await requireMarketingAccess(projectId, session.user.id)

  const raw = Number.parseInt(String(getQuery(event).days ?? ''), 10)
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, MIN_DAYS), MAX_DAYS) : DEFAULT_DAYS

  const [site, canManage] = await Promise.all([
    findMarketingSite(projectId),
    isMarketingAdminOf(projectId, session.user.id),
  ])
  const base = {
    configured: isGscConfigured(),
    // Built server-side from BETTER_AUTH_URL; the browser origin can differ behind a proxy.
    redirectUri: getGoogleRedirectUri(),
    canManage,
    site: site ? { origin: site.origin, verified: site.verifiedAt !== null } : null,
    days,
  }

  const conn = site ? await findGscConnection(site.id) : null
  if (!site || !conn) {
    return createSuccessResponse({
      ...base,
      connection: null,
      totals: null,
      daily: [],
      topQueries: [],
      queriesPeriodEnd: null,
    })
  }

  const [latest] = await db
    .select({ date: gscDailyMetric.date })
    .from(gscDailyMetric)
    .where(eq(gscDailyMetric.siteId, site.id))
    .orderBy(desc(gscDailyMetric.date))
    .limit(1)

  const rows = latest
    ? await db
        .select({
          date: gscDailyMetric.date,
          clicks: gscDailyMetric.clicks,
          impressions: gscDailyMetric.impressions,
          ctr: gscDailyMetric.ctr,
          position: gscDailyMetric.position,
        })
        .from(gscDailyMetric)
        .where(
          and(eq(gscDailyMetric.siteId, site.id), gte(gscDailyMetric.date, shiftDate(latest.date, -(2 * days - 1))))
        )
        .orderBy(asc(gscDailyMetric.date))
    : []
  const { current, previous } = splitPeriods(rows, days)

  const [snapshot] = await db
    .select({ periodEnd: gscQueryStat.periodEnd })
    .from(gscQueryStat)
    .where(eq(gscQueryStat.siteId, site.id))
    .orderBy(desc(gscQueryStat.periodEnd))
    .limit(1)
  const topQueries = snapshot
    ? await db
        .select({
          query: gscQueryStat.query,
          clicks: gscQueryStat.clicks,
          impressions: gscQueryStat.impressions,
          ctr: gscQueryStat.ctr,
          position: gscQueryStat.position,
        })
        .from(gscQueryStat)
        .where(and(eq(gscQueryStat.siteId, site.id), eq(gscQueryStat.periodEnd, snapshot.periodEnd)))
        .orderBy(desc(gscQueryStat.clicks), desc(gscQueryStat.impressions), asc(gscQueryStat.query))
        .limit(TOP_QUERIES)
    : []

  return createSuccessResponse({
    ...base,
    connection: {
      status: conn.status,
      email: conn.googleAccountEmail,
      propertyUrl: conn.propertyUrl,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
    },
    totals: current.length
      ? {
          current: computeTotals(current),
          previous: previous ? computeTotals(previous) : null,
          from: current[0].date,
          to: current[current.length - 1].date,
        }
      : null,
    daily: current,
    topQueries,
    queriesPeriodEnd: snapshot?.periodEnd ?? null,
  })
})
