import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  marketingSite,
  marketingTerm,
  mention,
  mentionSourceCursor,
  type MentionKind,
  type MentionSource,
} from '~/server/database/schema/marketing'
import { isModuleEnabled } from '~/lib/modules'
import { sqlTimestamp } from '~/server/utils/sql-timestamp'
import type { MatchTerm } from '~/server/services/social-sources'

// Mirrors POLL_INTERVAL_MS / FAILURE_BACKOFF_* in poller.ts (kept here to avoid a circular import)
const POLL_INTERVAL_SECONDS = 30 * 60
const BACKOFF_BASE_SECONDS = 15 * 60
const BACKOFF_MAX_SECONDS = 6 * 60 * 60

export interface CandidateSite {
  siteId: string
  organizationId: string
  projectId: string
  projectName: string
  projectSlug: string
  projectSettings: Record<string, unknown> | null
}

export interface MentionInsert {
  id: string
  siteId: string
  termId: string | null
  source: MentionSource
  externalId: string
  url: string
  author: string | null
  title: string | null
  excerpt: string
  score: number | null
  kind: MentionKind
  publishedAt: Date
}

export interface SourceCursorRow {
  siteId: string
  source: MentionSource
  /** Search-window watermark; only advances after a successful poll */
  lastPolledAt: Date
  /** Last attempt, successful or not. Null on rows written before this column existed */
  lastAttemptAt?: Date | null
  consecutiveFailures?: number
  /** Next query index to search; 0 (or past the end of the term list) starts a new rotation cycle */
  queryOffset?: number
  /** Start of the current rotation cycle (when offset 0 was searched); null when unknown */
  cycleStartedAt?: Date | null
}

/** Marketing must be switched on for the project (default off). */
export function isMarketingOn(site: Pick<CandidateSite, 'projectSettings'>): boolean {
  return isModuleEnabled(site.projectSettings, 'marketingEnabled')
}

/** Persistence seam for the mentions poller and digest, so both can be tested without a database. */
export interface MentionsStore {
  /** Verified sites with their module switches; callers filter with `isMarketingOn`. */
  loadVerifiedSites(): Promise<CandidateSite[]>
  /**
   * Candidate sites for a poll run, selected in SQL: verified, Marketing on for the project,
   * at least one term, and at least one of `sourceIds` due (never polled, or past its interval or
   * failure backoff). Least recently attempted first, at most `limit`.
   */
  loadDueSites(options: { now: Date; sourceIds: string[]; limit: number }): Promise<CandidateSite[]>
  /**
   * Atomically takes the (site, source) cursor for polling: stamps `last_attempt_at = now` only when
   * it is unset or older than `leaseMs`, creating the row (watermark `windowStart`) if missing.
   * Resolves false when another worker holds it.
   */
  claimCursor(siteId: string, source: MentionSource, now: Date, windowStart: Date, leaseMs: number): Promise<boolean>
  /**
   * Gives a claimed cursor back untouched (a rate-limited poll): restores `last_attempt_at` to the
   * value before the claim, only while it is still the claim's `claimedAt`.
   */
  releaseClaim(siteId: string, source: MentionSource, claimedAt: Date, previousAttempt: Date | null): Promise<void>
  loadTerms(siteIds: string[]): Promise<Map<string, MatchTerm[]>>
  loadCursors(siteIds: string[]): Promise<SourceCursorRow[]>
  insertMentions(rows: MentionInsert[]): Promise<number>
  saveCursor(
    siteId: string,
    source: MentionSource,
    lastPolledAt: Date,
    lastError: string | null,
    attempt: { at: Date; consecutiveFailures: number; queryOffset: number; cycleStartedAt: Date | null }
  ): Promise<void>
  deleteOlderThan(cutoff: Date, batchSize: number): Promise<number>
}

export const dbMentionsStore: MentionsStore = {
  async loadVerifiedSites() {
    const rows = await db
      .select({
        siteId: marketingSite.id,
        organizationId: project.organizationId,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        projectSettings: project.settings,
      })
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .where(isNotNull(marketingSite.verifiedAt))

    return rows.map((row) => ({
      ...row,
      projectSettings: (row.projectSettings as Record<string, unknown> | null) ?? null,
    }))
  },

  async loadDueSites({ now, sourceIds, limit }) {
    if (sourceIds.length === 0) return []
    const sources = sql.join(
      sourceIds.map((id) => sql`${id}`),
      sql`, `
    )
    const res = await db.execute<{
      site_id: string
      organization_id: string
      project_id: string
      name: string
      slug: string
      settings: Record<string, unknown> | null
    }>(sql`
      SELECT s.id AS site_id, p.organization_id, p.id AS project_id, p.name, p.slug, p.settings
      FROM marketing_site s
      JOIN project p ON p.id = s.project_id
      JOIN LATERAL (
        SELECT min(CASE WHEN c.site_id IS NULL THEN '-infinity'::timestamp
                        ELSE coalesce(c.last_attempt_at, c.last_polled_at) END) AS oldest
        FROM unnest(ARRAY[${sources}]::text[]) AS src(id)
        LEFT JOIN mention_source_cursor c ON c.site_id = s.id AND c.source = src.id
        WHERE c.site_id IS NULL
           OR coalesce(c.last_attempt_at, c.last_polled_at) + (
                CASE WHEN c.consecutive_failures <= 0
                     THEN ${POLL_INTERVAL_SECONDS}::float8 * interval '1 second'
                     ELSE LEAST(power(2, LEAST(c.consecutive_failures, 10)) * ${BACKOFF_BASE_SECONDS}::float8 * interval '1 second',
                                ${BACKOFF_MAX_SECONDS}::float8 * interval '1 second')
                END
              ) <= ${sqlTimestamp(now)}
      ) due ON due.oldest IS NOT NULL
      WHERE s.verified_at IS NOT NULL
        AND p.settings ->> 'marketingEnabled' = 'true'
        AND EXISTS (SELECT 1 FROM marketing_term mt WHERE mt.site_id = s.id)
      ORDER BY due.oldest ASC, s.id ASC
      LIMIT ${limit}
    `)
    return res.rows.map((row) => ({
      siteId: row.site_id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      projectName: row.name,
      projectSlug: row.slug,
      projectSettings: row.settings ?? null,
    }))
  },

  async claimCursor(siteId, source, now, windowStart, leaseMs) {
    const claimed = await db
      .insert(mentionSourceCursor)
      .values({ siteId, source, lastPolledAt: windowStart, lastAttemptAt: now, consecutiveFailures: 0 })
      .onConflictDoUpdate({
        target: [mentionSourceCursor.siteId, mentionSourceCursor.source],
        set: { lastAttemptAt: now },
        setWhere: or(
          isNull(mentionSourceCursor.lastAttemptAt),
          lt(mentionSourceCursor.lastAttemptAt, new Date(now.getTime() - leaseMs))
        ),
      })
      .returning({ siteId: mentionSourceCursor.siteId })
    return claimed.length > 0
  },

  async releaseClaim(siteId, source, claimedAt, previousAttempt) {
    await db
      .update(mentionSourceCursor)
      .set({ lastAttemptAt: previousAttempt })
      .where(
        and(
          eq(mentionSourceCursor.siteId, siteId),
          eq(mentionSourceCursor.source, source),
          eq(mentionSourceCursor.lastAttemptAt, claimedAt)
        )
      )
  },

  async loadTerms(siteIds) {
    const result = new Map<string, MatchTerm[]>()
    if (siteIds.length === 0) return result
    const rows = await db
      .select({
        id: marketingTerm.id,
        siteId: marketingTerm.siteId,
        kind: marketingTerm.kind,
        label: marketingTerm.label,
        aliases: marketingTerm.aliases,
      })
      .from(marketingTerm)
      .where(inArray(marketingTerm.siteId, siteIds))
      .orderBy(marketingTerm.createdAt)

    for (const row of rows) {
      const list = result.get(row.siteId) ?? []
      list.push({ id: row.id, kind: row.kind, label: row.label, aliases: row.aliases ?? [] })
      result.set(row.siteId, list)
    }
    return result
  },

  async loadCursors(siteIds) {
    if (siteIds.length === 0) return []
    return db
      .select({
        siteId: mentionSourceCursor.siteId,
        source: mentionSourceCursor.source,
        lastPolledAt: mentionSourceCursor.lastPolledAt,
        lastAttemptAt: mentionSourceCursor.lastAttemptAt,
        consecutiveFailures: mentionSourceCursor.consecutiveFailures,
        queryOffset: mentionSourceCursor.queryOffset,
        cycleStartedAt: mentionSourceCursor.cycleStartedAt,
      })
      .from(mentionSourceCursor)
      .where(inArray(mentionSourceCursor.siteId, siteIds))
  },

  async insertMentions(rows) {
    if (rows.length === 0) return 0
    const inserted = await db
      .insert(mention)
      .values(rows)
      .onConflictDoNothing({ target: [mention.siteId, mention.source, mention.externalId] })
      .returning({ id: mention.id })
    return inserted.length
  },

  async saveCursor(siteId, source, lastPolledAt, lastError, attempt) {
    const attemptFields = {
      lastAttemptAt: attempt.at,
      consecutiveFailures: attempt.consecutiveFailures,
      queryOffset: attempt.queryOffset,
      cycleStartedAt: attempt.cycleStartedAt,
    }
    await db
      .insert(mentionSourceCursor)
      .values({ siteId, source, lastPolledAt, lastError, ...attemptFields })
      .onConflictDoUpdate({
        target: [mentionSourceCursor.siteId, mentionSourceCursor.source],
        set: { lastPolledAt, lastError, ...attemptFields },
      })
  },

  async deleteOlderThan(cutoff, batchSize) {
    const doomed = db.select({ id: mention.id }).from(mention).where(lt(mention.publishedAt, cutoff)).limit(batchSize)
    const deleted = await db.delete(mention).where(inArray(mention.id, doomed)).returning({ id: mention.id })
    return deleted.length
  },
}
