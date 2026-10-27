/**
 * Import commit engine. Applies a staged run to the database in phases (taxonomy, people, feedback, votes, comments,
 * changelog; see `commit-phases/`). There is no worker: small runs are advanced inline by the commit request, larger
 * ones by the `imports:advance` scheduled task, one bounded call at a time.
 *
 * - Serialized by a lease on the run row (`lease_until`), claimed with a conditional UPDATE. Unique indexes on the
 *   external ids are the backstop.
 * - Every record is applied in its own transaction and is idempotent, so a crashed call is safe to repeat.
 *   `progress = { phase, done, total }` is checkpointed (with the running counts) every CHECKPOINT_EVERY records, at
 *   each phase boundary and before the lease is released; the next call resumes from that checkpoint.
 * - No side effects: no notifications, emails, realtime, subscriptions, GitHub, or changelog publish hooks.
 */
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { importRun, importRunIssue } from '~/server/database/schema/imports'
import { createLogger } from '~/server/utils/logger'
import { ErrorCode } from '~/server/utils/response'
import type { IssueInput } from './format'
import { effectiveStatusValues, emptyCounts, loadRunBatch, type ImportSection, type SectionCounts } from './planner'
import { importHttpError, type ImportRunRow } from './runs'
import { resolveTaxonomy } from './taxonomy'
import { COMMIT_PHASES, type CommitContext, type CommitPhase, type CommitPhaseName } from './commit-phases/context'
import { taxonomyPhase } from './commit-phases/taxonomy'
import { peoplePhase } from './commit-phases/people'
import { feedbackPhase } from './commit-phases/feedback'
import { votesPhase } from './commit-phases/votes'
import { commentsPhase } from './commit-phases/comments'
import { changelogPhase } from './commit-phases/changelog'

const logger = createLogger('imports:commit')

/** Runs with at most this many records are committed inline by the commit request. */
export const INLINE_COMMIT_MAX_RECORDS = 500
export const INLINE_BUDGET_MS = 20_000
export const LEASE_MS = 3 * 60_000
const CHECKPOINT_EVERY = 100
const CHECKPOINT_INTERVAL_MS = 15_000

const PHASES: CommitPhase[] = [taxonomyPhase, peoplePhase, feedbackPhase, votesPhase, commentsPhase, changelogPhase]

export interface ImportSummary {
  counts: Record<ImportSection, SectionCounts>
  /** Records with at least one field kept because the team edited it in Veerify */
  kept: number
}

type Progress = { phase: string; done: number; total: number }

/** Starts the commit of a draft run. Runs up to INLINE_COMMIT_MAX_RECORDS records are applied before returning. */
export async function commitImportRun(runId: string): Promise<ImportRunRow> {
  const run = await loadRun(runId)
  if (run.status !== 'draft') conflict(`Import run is ${run.status}; only draft runs can be committed`)
  const now = new Date()
  const [started] = await db
    .update(importRun)
    .set({ status: 'committing', committedAt: now, updatedAt: now, leaseUntil: null, error: null })
    .where(and(eq(importRun.id, runId), eq(importRun.status, 'draft')))
    .returning()
  if (!started) conflict('Import run changed state; it cannot be committed')

  if (started.recordCount <= INLINE_COMMIT_MAX_RECORDS) {
    await advanceImportRun(runId, { budgetMs: INLINE_BUDGET_MS })
  }
  return loadRun(runId)
}

/**
 * Advances a committing run within `budgetMs`. Returns `{ done: false }` without doing anything when the lease is
 * held by another caller (or the run is not committing), and after releasing the lease on budget exhaustion.
 */
export async function advanceImportRun(runId: string, options: { budgetMs: number }): Promise<{ done: boolean }> {
  const started = Date.now()
  const [run] = await db
    .update(importRun)
    .set({ leaseUntil: new Date(started + LEASE_MS) })
    .where(
      and(
        eq(importRun.id, runId),
        eq(importRun.status, 'committing'),
        or(isNull(importRun.leaseUntil), lt(importRun.leaseUntil, new Date(started)))
      )
    )
    .returning()
  if (!run) return { done: false }

  try {
    return await applyPhases(run, started + options.budgetMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Import commit failed', { runId, error: message })
    await db
      .update(importRun)
      .set({ status: 'failed', error: message.slice(0, 2000), leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(importRun.id, runId), eq(importRun.status, 'committing')))
    return { done: true }
  }
}

/** Scheduled task body: advances committing runs whose lease is free, oldest commit first, within the budget. */
export async function advanceImportRuns(options: { budgetMs?: number } = {}): Promise<{ processed: number }> {
  const deadline = Date.now() + (options.budgetMs ?? 45_000)
  const due = await db
    .select({ id: importRun.id })
    .from(importRun)
    .where(
      and(eq(importRun.status, 'committing'), or(isNull(importRun.leaseUntil), lt(importRun.leaseUntil, new Date())))
    )
    .orderBy(asc(importRun.committedAt))
    .limit(20)
  let processed = 0
  for (const { id } of due) {
    const remaining = deadline - Date.now()
    if (remaining < 1_000) break
    try {
      await advanceImportRun(id, { budgetMs: remaining })
      processed++
    } catch (error) {
      logger.error('Import advance failed', { runId: id, error: error instanceof Error ? error.message : error })
    }
  }
  return { processed }
}

async function applyPhases(run: ImportRunRow, deadline: number): Promise<{ done: boolean }> {
  // Resume from the last checkpoint; anything unrecognised restarts from the first phase (records are idempotent).
  const progress = run.progress as Progress | null
  const resumeAt = progress ? COMMIT_PHASES.indexOf(progress.phase as CommitPhaseName) : -1
  let phaseIndex = Math.max(0, resumeAt)
  let done = resumeAt >= 0 ? progress!.done : 0

  const issues = await IssueLog.load(run.id)
  const summary = run.summary as Partial<ImportSummary> | null
  const batch = await loadRunBatch(run.id)
  const needsTaxonomy = phaseIndex <= COMMIT_PHASES.indexOf('feedback')
  const taxonomy = needsTaxonomy ? await resolveTaxonomy(run.projectId, batch, { apply: true }) : null
  const ctx: CommitContext = {
    run,
    batch,
    sync: run.onExisting !== 'skip',
    taxonomy,
    effectiveStatuses: taxonomy ? await effectiveStatusValues(run.projectId, taxonomy) : new Set(),
    counts: summary?.counts ?? emptyCounts(),
    kept: summary?.kept ?? 0,
    issue: (issue) => issues.add(issue),
    now: () => new Date(),
  }

  let lastCheckpoint = Date.now()
  const checkpoint = async (next: Progress, release = false) => {
    await issues.flush()
    lastCheckpoint = Date.now()
    const [row] = await db
      .update(importRun)
      .set({
        progress: next,
        summary: { counts: ctx.counts, kept: ctx.kept } satisfies ImportSummary,
        leaseUntil: release ? null : new Date(lastCheckpoint + LEASE_MS),
        updatedAt: new Date(),
      })
      .where(and(eq(importRun.id, run.id), eq(importRun.status, 'committing')))
      .returning({ id: importRun.id })
    // No row: the run was canceled meanwhile. Stop without touching it further.
    return !!row
  }

  for (; phaseIndex < PHASES.length; phaseIndex++, done = 0) {
    const phase = PHASES[phaseIndex]
    const items = phase.items(ctx)
    const total = items.length
    if (!(await checkpoint({ phase: phase.name, done, total }))) return { done: false }
    const state = done < total ? await phase.load(ctx) : undefined
    for (; done < total; done++) {
      if (Date.now() >= deadline) {
        await checkpoint({ phase: phase.name, done, total }, true)
        return { done: false }
      }
      await phase.apply(ctx, state, items[done])
      const sinceCheckpoint = Date.now() - lastCheckpoint
      if ((done + 1) % CHECKPOINT_EVERY === 0 || sinceCheckpoint > CHECKPOINT_INTERVAL_MS) {
        if (!(await checkpoint({ phase: phase.name, done: done + 1, total }))) return { done: false }
      }
    }
  }

  await issues.flush()
  const now = new Date()
  const [completed] = await db
    .update(importRun)
    .set({
      status: 'completed',
      completedAt: now,
      progress: { phase: 'done', done: run.recordCount, total: run.recordCount },
      summary: { counts: ctx.counts, kept: ctx.kept } satisfies ImportSummary,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(and(eq(importRun.id, run.id), eq(importRun.status, 'committing')))
    .returning({ id: importRun.id })
  return { done: !!completed }
}

/**
 * Issues found while committing, written to import_run_issue. Deduplicated against rows already stored for the run
 * (staged issues from add time, and issues of an earlier call that re-applies the same records).
 */
class IssueLog {
  private pending: IssueInput[] = []

  private constructor(
    private runId: string,
    private seen: Set<string>
  ) {}

  static async load(runId: string) {
    const rows = await db
      .select({
        severity: importRunIssue.severity,
        entityType: importRunIssue.entityType,
        externalId: importRunIssue.externalId,
        message: importRunIssue.message,
      })
      .from(importRunIssue)
      .where(eq(importRunIssue.runId, runId))
    return new IssueLog(runId, new Set(rows.map((r) => IssueLog.key(r))))
  }

  private static key(i: {
    severity?: string | null
    entityType?: string | null
    externalId?: string | null
    message: string
  }) {
    return [i.severity ?? '', i.entityType ?? '', i.externalId ?? '', i.message].join('\u0000')
  }

  add(issue: IssueInput) {
    const key = IssueLog.key(issue)
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.pending.push(issue)
  }

  async flush() {
    if (!this.pending.length) return
    const rows = this.pending
    this.pending = []
    const now = new Date()
    await db.insert(importRunIssue).values(
      rows.map((issue) => ({
        id: crypto.randomUUID(),
        runId: this.runId,
        severity: issue.severity,
        entityType: issue.entityType,
        externalId: issue.externalId ?? null,
        message: issue.message,
        createdAt: now,
      }))
    )
  }
}

async function loadRun(runId: string): Promise<ImportRunRow> {
  const [run] = await db.select().from(importRun).where(eq(importRun.id, runId)).limit(1)
  if (!run) importHttpError(404, 'Not Found', ErrorCode.NOT_FOUND, 'Import run not found')
  return run
}

function conflict(message: string): never {
  return importHttpError(409, 'Conflict', ErrorCode.CONFLICT, message)
}
