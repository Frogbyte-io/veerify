import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { gscConnection, gscDailyMetric, gscQueryStat, marketingSite } from '~/server/database/schema/marketing'
import {
  getGoogleOAuthConfig,
  GoogleApiError,
  GoogleAuthError,
  isPropertySelectableForOrigin,
  querySearchAnalytics,
  type GoogleOAuthConfig,
  type SearchAnalyticsOptions,
  type SearchAnalyticsRow,
} from '~/server/services/google/search-console'
import { isMarketingOn, type CandidateSite } from '~/server/services/marketing/mentions/store'
import { getAccessTokenFor, REVOKED_MESSAGE } from '~/server/services/marketing/search/connection'
import { shiftDate } from '~/server/services/marketing/search/summary'
import { runPool } from '~/server/utils/task-pool'
import { createLogger } from '~/server/utils/logger'
import { isSecretsConfigured } from '~/server/utils/secrets'

const logger = createLogger('marketing-search-sync')

export const PROPERTY_MISMATCH_MESSAGE =
  'The Search Console property no longer matches the site address — choose a property'

/**
 * A connection is due once its last sync is older than this. Slightly under a
 * day so an hourly tick does not push a daily sync out to 25 hours.
 */
export const SYNC_DUE_AFTER_MS = 23 * 60 * 60 * 1000
export const DAILY_LOOKBACK_DAYS = 90
export const QUERY_WINDOW_DAYS = 28
/** Search Console's final data lags by about three days */
export const QUERY_END_LAG_DAYS = 3
export const QUERY_ROW_LIMIT = 1000
/** With one sync per day this is about 12 days of query history. */
export const SNAPSHOTS_TO_KEEP = 12
/** Sites synced per hourly run; with a daily sync each, this covers 2,400 connected sites a day */
export const MAX_SITES_PER_TICK = 100
/** Sites synced at the same time (Google's per-project quota is far above this) */
export const SYNC_CONCURRENCY = 5
export const TIME_BUDGET_MS = 45_000
const INSERT_CHUNK = 500
const MAX_QUERY_LENGTH = 500

export interface SyncCandidate extends CandidateSite {
  /** Current site origin, to check the property still belongs to it */
  origin: string
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

export interface SyncWrite {
  siteId: string
  /** The property the data was fetched for; the write is skipped if the connection moved on */
  propertyUrl: string
  at: Date
  daily: DailyMetricInsert[]
  periodEnd: string
  queryRows: QueryStatInsert[]
  keep: number
}

/** Persistence seam so the sync can be tested without a database. */
export interface SearchSyncStore {
  loadDue(now: Date, limit?: number): Promise<SyncCandidate[]>
  /**
   * Takes the site for this run: stamps `last_sync_at = now` only while it is still unset or older than
   * `cutoff`, so two replicas never sync the same site. Resolves false when another worker took it.
   */
  claim(siteId: string, cutoff: Date, now: Date): Promise<boolean>
  /**
   * Writes daily metrics, replaces the query snapshot (pruned to the most recent
   * `keep`) and marks the site synced, all in one transaction. Returns false and
   * writes nothing when the connection no longer points at `propertyUrl`.
   */
  commitSync(write: SyncWrite): Promise<boolean>
  markFailed(siteId: string, at: Date, message: string, revoked: boolean): Promise<void>
  /** Flags a connection whose property no longer matches the site origin so the user picks one again */
  markNeedsProperty(siteId: string, at: Date): Promise<void>
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

/** The registry default for the Marketing switch is off. */
const projectMarketingOn = sql`coalesce(${project.settings}->'marketingEnabled' = 'true'::jsonb, false)`

export const dbSearchSyncStore: SearchSyncStore = {
  async claim(siteId, cutoff, now) {
    const rows = await db
      .update(gscConnection)
      .set({ lastSyncAt: now })
      .where(
        and(
          eq(gscConnection.siteId, siteId),
          eq(gscConnection.status, 'connected'),
          or(sql`${gscConnection.lastSyncAt} is null`, lt(gscConnection.lastSyncAt, cutoff))
        )
      )
      .returning({ siteId: gscConnection.siteId })
    return rows.length > 0
  },

  async loadDue(now, limit = MAX_SITES_PER_TICK) {
    const cutoff = new Date(now.getTime() - SYNC_DUE_AFTER_MS)
    const rows = await db
      .select({
        siteId: marketingSite.id,
        organizationId: project.organizationId,
        origin: marketingSite.origin,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        projectSettings: project.settings,
        propertyUrl: gscConnection.propertyUrl,
        encryptedRefreshToken: gscConnection.encryptedRefreshToken,
        lastSyncAt: gscConnection.lastSyncAt,
      })
      .from(gscConnection)
      .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .where(
        and(
          eq(gscConnection.status, 'connected'),
          isNotNull(gscConnection.propertyUrl),
          isNotNull(marketingSite.verifiedAt),
          // The module switch is part of the query so sites with marketing off cannot fill the LIMIT
          projectMarketingOn,
          or(sql`${gscConnection.lastSyncAt} is null`, lt(gscConnection.lastSyncAt, cutoff))
        )
      )
      .orderBy(sql`${gscConnection.lastSyncAt} asc nulls first`)
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      propertyUrl: row.propertyUrl as string,
      projectSettings: (row.projectSettings as Record<string, unknown> | null) ?? null,
    }))
  },

  async commitSync(write) {
    return db.transaction(async (tx) => {
      // Same row lock as property changes, reconnects and disconnects (connection.ts)
      const [conn] = await tx
        .select({ propertyUrl: gscConnection.propertyUrl, status: gscConnection.status })
        .from(gscConnection)
        .where(eq(gscConnection.siteId, write.siteId))
        .for('update')
        .limit(1)
      if (!conn || conn.status !== 'connected' || conn.propertyUrl !== write.propertyUrl) return false

      for (const part of chunks(write.daily, INSERT_CHUNK)) {
        await tx
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

      await tx
        .delete(gscQueryStat)
        .where(and(eq(gscQueryStat.siteId, write.siteId), eq(gscQueryStat.periodEnd, write.periodEnd)))
      for (const part of chunks(write.queryRows, INSERT_CHUNK)) await tx.insert(gscQueryStat).values(part)

      const snapshots = await tx
        .selectDistinct({ periodEnd: gscQueryStat.periodEnd })
        .from(gscQueryStat)
        .where(eq(gscQueryStat.siteId, write.siteId))
        .orderBy(desc(gscQueryStat.periodEnd))
      const stale = snapshots.slice(write.keep).map((snapshot) => snapshot.periodEnd)
      if (stale.length > 0) {
        await tx
          .delete(gscQueryStat)
          .where(and(eq(gscQueryStat.siteId, write.siteId), inArray(gscQueryStat.periodEnd, stale)))
      }

      await tx
        .update(gscConnection)
        .set({ lastSyncAt: write.at, lastError: null, updatedAt: write.at })
        .where(eq(gscConnection.siteId, write.siteId))
      return true
    })
  },

  async markNeedsProperty(siteId, at) {
    await db
      .update(gscConnection)
      .set({ status: 'needs_property', lastError: PROPERTY_MISMATCH_MESSAGE, updatedAt: at })
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
): Promise<boolean> {
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

  // Write only after both fetches succeed, in one transaction, so a failure never leaves a half-updated
  // site and a property change that happened meanwhile is not overwritten with the old property's data.
  return store.commitSync({
    siteId: candidate.siteId,
    propertyUrl: candidate.propertyUrl,
    at: now,
    daily,
    periodEnd,
    queryRows: [...byQuery.values()],
    keep: SNAPSHOTS_TO_KEEP,
  })
}

export async function syncSearchConsole(
  options: { now?: Date; maxSites?: number; timeBudgetMs?: number; concurrency?: number } = {},
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
  const cutoff = new Date(now.getTime() - SYNC_DUE_AFTER_MS)
  const due = (await store.loadDue(now, maxSites)).filter(isMarketingOn).slice(0, maxSites)

  await runPool(
    due,
    options.concurrency ?? SYNC_CONCURRENCY,
    async (candidate) => {
      // The site origin changed after the property was chosen: never sync (or store) another site's data
      if (!isPropertySelectableForOrigin(candidate.origin, candidate.propertyUrl)) {
        try {
          await store.markNeedsProperty(candidate.siteId, now)
        } catch {
          // Retried on the next tick
        }
        logger.info('Search Console sync skipped, the property does not match the site origin', {
          siteId: candidate.siteId,
        })
        return
      }
      try {
        // Lost the race to another replica (or an overlapping run): it syncs this site
        if (!(await store.claim(candidate.siteId, cutoff, now))) return
        const written = await syncOne(candidate, now, config, store, getAccessToken, query)
        if (written) summary.sitesSynced += 1
        else logger.info('Search Console sync skipped, the connection changed meanwhile', { siteId: candidate.siteId })
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
    },
    () => Date.now() - started >= budget
  )

  return summary
}
