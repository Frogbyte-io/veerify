import { inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityAnswer } from '~/server/database/schema/marketing'

export interface RunProgress {
  total: number
  pending: number
  done: number
  failed: number
}

/** Answer counts per run, for progress bars and run lists. */
export async function getRunProgress(runIds: string[]): Promise<Record<string, RunProgress>> {
  if (runIds.length === 0) return {}
  const rows = await db
    .select({
      runId: aiVisibilityAnswer.runId,
      total: sql<number>`count(*)`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'pending')`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'done')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'failed')`.mapWith(Number),
    })
    .from(aiVisibilityAnswer)
    .where(inArray(aiVisibilityAnswer.runId, runIds))
    .groupBy(aiVisibilityAnswer.runId)

  return Object.fromEntries(
    rows.map((row) => [row.runId, { total: row.total, pending: row.pending, done: row.done, failed: row.failed }])
  )
}

export const EMPTY_PROGRESS: RunProgress = { total: 0, pending: 0, done: 0, failed: 0 }
