import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, importedPerson } from '~/server/database/schema/feedback'
import type { ImportBatch, IssueInput } from '../format'
import type { ImportSection, SectionCounts } from '../planner'
import type { ImportRunRow } from '../runs'
import type { TaxonomyResolution } from '../taxonomy'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const COMMIT_PHASES = ['taxonomy', 'people', 'feedback', 'votes', 'comments', 'changelog'] as const
export type CommitPhaseName = (typeof COMMIT_PHASES)[number]

/** State shared by the phases of one advance call. Counts and `kept` are persisted with the progress. */
export interface CommitContext {
  run: ImportRunRow
  batch: ImportBatch
  /** onExisting = 'sync' (default); false means 'skip': only records not seen before are created */
  sync: boolean
  /** Resolved with apply:true; null once the feedback phase is behind us (later phases don't need it) */
  taxonomy: TaxonomyResolution | null
  effectiveStatuses: Set<string>
  counts: Record<ImportSection, SectionCounts>
  /** Records with at least one field kept because it was edited in Veerify */
  kept: number
  issue(issue: IssueInput): void
  now(): Date
}

/**
 * One commit phase. `items` must be deterministic for a run (progress.done indexes into it); `apply` handles one
 * record in its own transaction and must be idempotent, because a crashed call re-applies records after the last
 * checkpoint.
 */
export interface CommitPhase<S = any, T = any> {
  name: CommitPhaseName
  items(ctx: CommitContext): readonly T[]
  load(ctx: CommitContext): Promise<S>
  apply(ctx: CommitContext, state: S, item: T): Promise<void>
}

export type PersonRef = { id: string; name: string | null; email: string | null }

/** Imported people of the run's project and source, by externalId. */
export async function loadPeople(ctx: CommitContext): Promise<Map<string, PersonRef>> {
  const rows = await db
    .select({
      id: importedPerson.id,
      externalId: importedPerson.externalId,
      name: importedPerson.name,
      email: importedPerson.email,
    })
    .from(importedPerson)
    .where(and(eq(importedPerson.projectId, ctx.run.projectId), eq(importedPerson.source, ctx.run.source)))
  return new Map(rows.map((r) => [r.externalId, { id: r.id, name: r.name, email: r.email }]))
}

export type FeedbackRef = { id: string; importRunId: string | null }

/** Feedback of the run's project imported from its source, by externalId. */
export async function loadFeedback(ctx: CommitContext): Promise<Map<string, FeedbackRef>> {
  const rows = await db
    .select({
      id: feedback.id,
      externalId: feedback.externalId,
      importRunId: sql<string | null>`${feedback.metadata}->'import'->>'runId'`,
    })
    .from(feedback)
    .where(and(eq(feedback.projectId, ctx.run.projectId), eq(feedback.externalSource, ctx.run.source)))
  return new Map(rows.filter((r) => r.externalId).map((r) => [r.externalId!, { id: r.id, importRunId: r.importRunId }]))
}

export function sourceDate(value: string | undefined, fallback: Date): Date {
  return value ? new Date(value) : fallback
}
