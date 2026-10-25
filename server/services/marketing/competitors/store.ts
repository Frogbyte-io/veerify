import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  competitorChange,
  competitorWatch,
  marketingSite,
  marketingTerm,
  type CompetitorWatchKind,
  type CompetitorWatchStatus,
} from '~/server/database/schema/marketing'
import { sqlTimestamp } from '~/server/utils/sql-timestamp'

export interface WatchContext {
  id: string
  siteId: string
  organizationId: string
  projectId: string
  projectName: string
  projectSettings: Record<string, unknown> | null
  termLabel: string
  /** The competitor term's current domain; null when it was cleared. */
  competitorDomain: string | null
  url: string
  kind: CompetitorWatchKind
  status: CompetitorWatchStatus
  lastCheckedAt: Date | null
  lastContentHash: string | null
  /** Not loaded with due watches (large); `CompetitorStore.loadLastText` fetches it when a diff is needed */
  lastText?: string | null
  consecutiveFailures: number
}

export interface WatchPatch {
  status?: CompetitorWatchStatus
  lastCheckedAt?: Date | null
  lastChangedAt?: Date
  lastContentHash?: string | null
  lastText?: string | null
  lastError?: string | null
  consecutiveFailures?: number
}

export interface ChangeInsert {
  siteId: string
  watchId: string
  detectedAt: Date
  addedText: string
  removedText: string
}

export interface ChangeSummary {
  summary: string
  provider: string
  model: string
}

/** Persistence seam for the checker so it can be tested without a database. */
export interface CompetitorStore {
  /**
   * Active, verified, marketing-on watches not checked since `cutoff`, oldest first (never-checked
   * first), with at most `MAX_PAGES_PER_HOST` distinct pages per host so one popular host cannot
   * crowd out the others. Loads the content hash but not the stored text. `scope` narrows to watches never checked (`never`) or due for a recheck (`recheck`), so the
   * checker can reserve a share of each run for new watches.
   */
  loadDue(cutoff: Date, limit: number, scope?: 'all' | 'never' | 'recheck'): Promise<WatchContext[]>
  /** The stored page text of a watch (null when none), read only when the content hash changed */
  loadLastText(id: string): Promise<string | null>
  /**
   * Marks the watch as picked up by this run; false when another run (cron or manual) took it first.
   * `anyStatus` lets a manual check claim a blocked/errored watch to re-test it (never a paused one).
   */
  claim(id: string, cutoff: Date, now: Date, opts?: { anyStatus?: boolean }): Promise<boolean>
  save(id: string, patch: WatchPatch): Promise<void>
  insertChange(row: ChangeInsert): Promise<string>
  saveSummary(changeId: string, summary: ChangeSummary): Promise<void>
}

const contextColumns = {
  id: competitorWatch.id,
  siteId: competitorWatch.siteId,
  organizationId: project.organizationId,
  projectId: marketingSite.projectId,
  projectName: project.name,
  projectSettings: project.settings,
  termLabel: marketingTerm.label,
  competitorDomain: marketingTerm.competitorDomain,
  url: competitorWatch.url,
  kind: competitorWatch.kind,
  status: competitorWatch.status,
  lastCheckedAt: competitorWatch.lastCheckedAt,
  lastContentHash: competitorWatch.lastContentHash,
  consecutiveFailures: competitorWatch.consecutiveFailures,
}

function baseQuery() {
  return db
    .select(contextColumns)
    .from(competitorWatch)
    .innerJoin(marketingSite, eq(marketingSite.id, competitorWatch.siteId))
    .innerJoin(marketingTerm, eq(marketingTerm.id, competitorWatch.termId))
    .innerJoin(project, eq(project.id, marketingSite.projectId))
}

function toContext(row: Awaited<ReturnType<typeof baseQuery>>[number]): WatchContext {
  return { ...row, projectSettings: (row.projectSettings as Record<string, unknown> | null) ?? null }
}

/** Distinct pages per host considered due in one run (mirrors MAX_PAGES_PER_HOST in checker.ts) */
const MAX_PAGES_PER_HOST = 5

/**
 * The due-watches statement: every gate is applied before ranking, then at most MAX_PAGES_PER_HOST
 * distinct URLs per host are kept (`dense_rank` over the URL within the host, so every project watching
 * one URL stays together and shares its single fetch), oldest first, then LIMIT.
 */
export function buildDueWatchesQuery(cutoff: Date, limit: number, scope: 'all' | 'never' | 'recheck') {
  const scopeSql =
    scope === 'never'
      ? sql`w.last_checked_at IS NULL`
      : scope === 'recheck'
        ? sql`w.last_checked_at < ${sqlTimestamp(cutoff)}`
        : sql`(w.last_checked_at IS NULL OR w.last_checked_at < ${sqlTimestamp(cutoff)})`
  return sql`
    SELECT * FROM (
      SELECT w.id, w.site_id, p.organization_id, s.project_id, p.name AS project_name, p.settings AS project_settings,
             t.label AS term_label, t.competitor_domain, w.url, w.kind, w.status, w.last_checked_at,
             w.last_content_hash, w.consecutive_failures,
             dense_rank() OVER (
               PARTITION BY regexp_replace(lower(substring(w.url from '^[a-zA-Z]+://([^/:?#]+)')), '^www[.]', '')
               ORDER BY w.url
             ) AS host_page_rank
      FROM competitor_watch w
      JOIN marketing_site s ON s.id = w.site_id
      JOIN marketing_term t ON t.id = w.term_id
      JOIN project p ON p.id = s.project_id
      WHERE w.status = 'active'
        AND s.verified_at IS NOT NULL
        AND p.settings ->> 'marketingEnabled' = 'true'
        AND ${scopeSql}
    ) due
    WHERE host_page_rank <= ${MAX_PAGES_PER_HOST}
    ORDER BY last_checked_at ASC NULLS FIRST, id ASC
    LIMIT ${limit}
  `
}

/** One watch with its site context, scoped to the site. Does not apply the module gates. */
export async function loadWatchContext(watchId: string, siteId: string): Promise<WatchContext | null> {
  const [row] = await baseQuery()
    .where(and(eq(competitorWatch.id, watchId), eq(competitorWatch.siteId, siteId)))
    .limit(1)
  return row ? toContext(row) : null
}

export const dbCompetitorStore: CompetitorStore = {
  async loadDue(cutoff, limit, scope = 'all') {
    const res = await db.execute<{
      id: string
      site_id: string
      organization_id: string
      project_id: string
      project_name: string
      project_settings: Record<string, unknown> | null
      term_label: string
      competitor_domain: string | null
      url: string
      kind: CompetitorWatchKind
      status: CompetitorWatchStatus
      last_checked_at: Date | string | null
      last_content_hash: string | null
      consecutive_failures: number
    }>(buildDueWatchesQuery(cutoff, limit, scope))
    return res.rows.map((row) => ({
      id: row.id,
      siteId: row.site_id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectSettings: row.project_settings ?? null,
      termLabel: row.term_label,
      competitorDomain: row.competitor_domain,
      url: row.url,
      kind: row.kind,
      status: row.status,
      lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at) : null,
      lastContentHash: row.last_content_hash,
      consecutiveFailures: Number(row.consecutive_failures),
    }))
  },

  async loadLastText(id) {
    const [row] = await db
      .select({ lastText: competitorWatch.lastText })
      .from(competitorWatch)
      .where(eq(competitorWatch.id, id))
      .limit(1)
    return row?.lastText ?? null
  },

  async claim(id, cutoff, now, opts) {
    const rows = await db
      .update(competitorWatch)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(
        and(
          eq(competitorWatch.id, id),
          opts?.anyStatus ? ne(competitorWatch.status, 'paused') : eq(competitorWatch.status, 'active'),
          or(isNull(competitorWatch.lastCheckedAt), lt(competitorWatch.lastCheckedAt, cutoff))
        )
      )
      .returning({ id: competitorWatch.id })
    return rows.length > 0
  },

  async save(id, patch) {
    await db
      .update(competitorWatch)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(competitorWatch.id, id))
  },

  async insertChange(row) {
    const id = randomUUID()
    await db.insert(competitorChange).values({ id, ...row, createdAt: new Date() })
    return id
  },

  async saveSummary(changeId, summary) {
    await db.update(competitorChange).set(summary).where(eq(competitorChange.id, changeId))
  },
}
