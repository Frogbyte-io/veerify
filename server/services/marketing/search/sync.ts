import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { gscConnection, gscDailyMetric, gscQueryStat, marketingSite } from '~/server/database/schema/marketing'
import { teamModuleSettings } from '~/server/database/schema/teams'
import {
  getGoogleOAuthConfig,
  GoogleApiError,
  GoogleAuthError,
  querySearchAnalytics,
  type GoogleOAuthConfig,
  type SearchAnalyticsOptions,
  type SearchAnalyticsRow,
} from '~/server/services/google/search-console'
import { isMarketingOn, type CandidateSite } from '~/server/services/marketing/mentions/store'
import { getAccessTokenFor, REVOKED_MESSAGE } from '~/server/services/marketing/search/connection'
import { shiftDate } from '~/server/services/marketing/search/summary'
import { createLogger } from '~/server/utils/logger'
import { isSecretsConfigured } from '~/server/utils/secrets'

const logger = createLogger('marketing-search-sync')

export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
export const DAILY_LOOKBACK_DAYS = 90
export const QUERY_WINDOW_DAYS = 28
/** Search Console's final data lags by about three days */
export const QUERY_END_LAG_DAYS = 3
export const QUERY_ROW_LIMIT = 1000
export const SNAPSHOTS_TO_KEEP = 12
export const MAX_SITES_PER_TICK = 20
export const TIME_BUDGET_MS = 45_000
const INSERT_CHUNK = 500
const MAX_QUERY_LENGTH = 500

export interface SyncCandidate extends CandidateSite {
  propertyUrl: string
  encryptedRefreshToken: string
  lastSyncAt: Date | null
}

export interface DailyMetricInsert {
  siteId: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface QueryStatInsert {
  siteId: string
  periodEnd: string
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Persistence seam so the sync can be tested without a database. */
export interface SearchSyncStore {
  loadDue(now: Date): Promise<SyncCandidate[]>
  upsertDaily(rows: DailyMetricInsert[]): Promise<void>
  /** Replaces the snapshot for `periodEnd` and prunes to the most recent `keep` snapshots */
  replaceQuerySnapshot(siteId: string, periodEnd: string, rows: QueryStatInsert[], keep: number): Promise<void>
  markSynced(siteId: string, at: Date): Promise<void>
  markFailed(siteId: string, at: Date, message: string, revoked: boolean): Promise<void>
}

export interface SyncSummary {
  sitesSynced: number
  sitesFailed: number
  skipped: boolean
}

export interface SyncDeps {
  store?: SearchSyncStore
  config?: GoogleOAuthConfig | null
  secretsConfigured?: boolean
  getAccessToken?: (candidate: SyncCandidate, config: GoogleOAuthConfig) => Promise<string>
  query?: (accessToken: string, siteUrl: string, options: SearchAnalyticsOptions) => Promise<SearchAnalyticsRow[]>
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

export const dbSearchSyncStore: SearchSyncStore = {
  async loadDue(now) {
    const cutoff = new Date(now.getTime() - SYNC_INTERVAL_MS)
    const rows = await db
      .select({
        siteId: marketingSite.id,
        teamId: marketingSite.teamId,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        projectSettings: project.settings,
        teamMarketingEnabled: teamModuleSettings.marketingEnabled,
        propertyUrl: gscConnection.propertyUrl,
        encryptedRefreshToken: gscConnection.encryptedRefreshToken,
        lastSyncAt: gscConnection.lastSyncAt,
      })
      .from(gscConnection)
      .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
      .where(
        and(
          eq(gscConnection.status, 'connected'),
          isNotNull(gscConnection.propertyUrl),
          isNotNull(marketingSite.verifiedAt),
          or(sql`${gscConnection.lastSyncAt} is null`, lt(gscConnection.lastSyncAt, cutoff))
        )
      )
      .orderBy(sql`${gscConnection.lastSyncAt} asc nulls first`)
      .limit(200)

    return rows.map((row) => ({
      ...row,
      propertyUrl: row.propertyUrl as string,
      projectSettings: (row.projectSettings as Record<string, unknown> | null) ?? null,
      teamMarketingEnabled: row.teamMarketingEnabled ?? null,
    }))
  },

  async upsertDaily(rows) {
    for (const part of chunks(rows, INSERT_CHUNK)) {
      await db
        .insert(gscDailyMetric)
        .values(part)
        .onConflictDoUpdate({
          target: [gscDailyMetric.siteId, gscDailyMetric.date],
          set: {
            clicks: sql`excluded.clicks`,
            impressions: sql`excluded.impressions`,
            ctr: sql`excluded.ctr`,
            position: sql`excluded.position`,
          },
        })
    }
  },

  async replaceQuerySnapshot(siteId, periodEnd, rows, keep) {
    await db.transaction(async (tx) => {
      await tx.delete(gscQueryStat).where(and(eq(gscQueryStat.siteId, siteId), eq(gscQueryStat.periodEnd, periodEnd)))
      for (const part of chunks(rows, INSERT_CHUNK)) await tx.insert(gscQueryStat).values(part)

      const snapshots = await tx
        .selectDistinct({ periodEnd: gscQueryStat.periodEnd })
        .from(gscQueryStat)
        .where(eq(gscQueryStat.siteId, siteId))
        .orderBy(desc(gscQueryStat.periodEnd))
      const stale = snapshots.slice(keep).map((s) => s.periodEnd)
      if (stale.length > 0) {
        await tx
          .delete(gscQueryStat)
          .where(and(eq(gscQueryStat.siteId, siteId), inArray(gscQueryStat.periodEnd, stale)))
      }
    })
  },

  async markSynced(siteId, at) {
    await db
      .update(gscConnection)
      .set({ lastSyncAt: at, lastError: null, updatedAt: at })
      .where(eq(gscConnection.siteId, siteId))
  },

  async markFailed(siteId, at, message, revoked) {
    await db
      .update(gscConnection)
      .set(
        revoked
          ? { status: 'error', lastError: message, updatedAt: at }
          : // lastSyncAt doubles as "last attempt" so a failing site retries tomorrow, not every tick
            { lastError: message, lastSyncAt: at, updatedAt: at }
      )
      .where(eq(gscConnection.siteId, siteId))
  },
}

/** Row to insert, or null when the row has no usable query key. */
export function toQueryStat(siteId: string, periodEnd: string, row: SearchAnalyticsRow): QueryStatInsert | null {
  const query = (row.keys[0] ?? '').slice(0, MAX_QUERY_LENGTH)
  if (!query) return null
  return {
    siteId,
    periodEnd,
    query,
    clicks: Math.round(row.clicks),
    impressions: Math.round(row.impressions),
    ctr: row.ctr,
    position: row.position,
  }
}

function describeError(error: unknown): string {
  if (error instanceof GoogleApiError) return `Search Console sync failed: ${error.message}`.slice(0, 300)
  return 'Search Console sync failed: unexpected error'
}

async function syncOne(
  candidate: SyncCandidate,
  now: Date,
  config: GoogleOAuthConfig,
  store: SearchSyncStore,
  getAccessToken: NonNullable<SyncDeps['getAccessToken']>,
  query: NonNullable<SyncDeps['query']>
) {
  const accessToken = await getAccessToken(candidate, config)
  const today = isoDate(now)

  const dailyRows = await query(accessToken, candidate.propertyUrl, {
    startDate: shiftDate(today, -DAILY_LOOKBACK_DAYS),
    endDate: today,
    dimensions: ['date'],
    rowLimit: DAILY_LOOKBACK_DAYS + 10,
    dataState: 'final',
  })
  const daily: DailyMetricInsert[] = dailyRows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.keys[0] ?? ''))
    .map((row) => ({
      siteId: candidate.siteId,
      date: row.keys[0],
      clicks: Math.round(row.clicks),
      impressions: Math.round(row.impressions),
      ctr: row.ctr,
      position: row.position,
    }))

  const periodEnd = shiftDate(today, -QUERY_END_LAG_DAYS)
  const queryRows = await query(accessToken, candidate.propertyUrl, {
    startDate: shiftDate(periodEnd, -(QUERY_WINDOW_DAYS - 1)),
    endDate: periodEnd,
    dimensions: ['query'],
    rowLimit: QUERY_ROW_LIMIT,
  })
  const byQuery = new Map<string, QueryStatInsert>()
  for (const row of queryRows) {
    const stat = toQueryStat(candidate.siteId, periodEnd, row)
    if (stat && !byQuery.has(stat.query)) byQuery.set(stat.query, stat)
  }

  // Write only after both fetches succeed, so a failure never leaves a half-updated site.
  if (daily.length > 0) await store.upsertDaily(daily)
  await store.replaceQuerySnapshot(candidate.siteId, periodEnd, [...byQuery.values()], SNAPSHOTS_TO_KEEP)
  await store.markSynced(candidate.siteId, now)
}

export async function syncSearchConsole(
  options: { now?: Date; maxSites?: number; timeBudgetMs?: number } = {},
  deps: SyncDeps = {}
): Promise<SyncSummary> {
  const now = options.now ?? new Date()
  const maxSites = options.maxSites ?? MAX_SITES_PER_TICK
  const budget = options.timeBudgetMs ?? TIME_BUDGET_MS
  const store = deps.store ?? dbSearchSyncStore
  const config = deps.config === undefined ? getGoogleOAuthConfig() : deps.config
  const secretsOk = deps.secretsConfigured ?? isSecretsConfigured()
  const getAccessToken = deps.getAccessToken ?? ((c, cfg) => getAccessTokenFor(c, cfg))
  const query = deps.query ?? querySearchAnalytics
  const summary: SyncSummary = { sitesSynced: 0, sitesFailed: 0, skipped: false }

  if (!config || !secretsOk) {
    summary.skipped = true
    return summary
  }

  const started = Date.now()
  const due = (await store.loadDue(now)).filter(isMarketingOn).slice(0, maxSites)

  for (const candidate of due) {
    if (Date.now() - started >= budget) break
    try {
      await syncOne(candidate, now, config, store, getAccessToken, query)
      summary.sitesSynced += 1
    } catch (error) {
      summary.sitesFailed += 1
      const revoked = error instanceof GoogleAuthError
      logger.warn('Search Console sync failed', {
        siteId: candidate.siteId,
        kind: error instanceof GoogleApiError ? error.kind : 'unknown',
      })
      try {
        await store.markFailed(candidate.siteId, now, revoked ? REVOKED_MESSAGE : describeError(error), revoked)
      } catch (storeError) {
        logger.error('Failed to record Search Console sync failure', {
          siteId: candidate.siteId,
          error: storeError instanceof Error ? storeError.message : 'unknown',
        })
      }
    }
  }

  return summary
}
