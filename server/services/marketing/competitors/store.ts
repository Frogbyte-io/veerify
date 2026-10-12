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
import { teamModuleSettings } from '~/server/database/schema/teams'

export interface WatchContext {
  id: string
  siteId: string
  teamId: string
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
  lastText: string | null
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
   * first). `scope` narrows to watches never checked (`never`) or due for a recheck (`recheck`), so the
   * checker can reserve a share of each run for new watches.
   */
  loadDue(cutoff: Date, limit: number, scope?: 'all' | 'never' | 'recheck'): Promise<WatchContext[]>
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
  teamId: marketingSite.teamId,
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
  lastText: competitorWatch.lastText,
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

/** One watch with its site context, scoped to the site. Does not apply the module gates. */
export async function loadWatchContext(watchId: string, siteId: string): Promise<WatchContext | null> {
  const [row] = await baseQuery()
    .where(and(eq(competitorWatch.id, watchId), eq(competitorWatch.siteId, siteId)))
    .limit(1)
  return row ? toContext(row) : null
}

export const dbCompetitorStore: CompetitorStore = {
  async loadDue(cutoff, limit, scope = 'all') {
    // Every gate is in SQL, before the LIMIT, so gated-off watches never crowd out due ones.
    const rows = await baseQuery()
      .innerJoin(
        teamModuleSettings,
        and(eq(teamModuleSettings.teamId, marketingSite.teamId), eq(teamModuleSettings.marketingEnabled, true))
      )
      .where(
        and(
          eq(competitorWatch.status, 'active'),
          sql`${marketingSite.verifiedAt} is not null`,
          sql`${project.settings}->>'marketingEnabled' = 'true'`,
          scope === 'never'
            ? isNull(competitorWatch.lastCheckedAt)
            : scope === 'recheck'
              ? lt(competitorWatch.lastCheckedAt, cutoff)
              : or(isNull(competitorWatch.lastCheckedAt), lt(competitorWatch.lastCheckedAt, cutoff))
        )
      )
      .orderBy(sql`${competitorWatch.lastCheckedAt} asc nulls first`)
      .limit(limit)
    return rows.map(toContext)
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
