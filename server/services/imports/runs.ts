import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { importRun, importRunBatch, importRunIssue } from '~/server/database/schema/imports'
import { listProducts, requireProductInProject } from '~/server/utils/project-access'
import { MAX_BATCH_RECORDS, MAX_RUN_RECORDS, countRecords } from './format'
import type { ImportBatch, IssueInput } from './format'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export type ImportRunRow = typeof importRun.$inferSelect

const SECTIONS = [
  ['statuses', 'status'],
  ['categories', 'category'],
  ['people', 'person'],
  ['feedback', 'feedback'],
  ['comments', 'comment'],
  ['changelog', 'changelog'],
] as const

export function importHttpError(statusCode: number, statusMessage: string, code: string, message: string): never {
  throw createError({ statusCode, statusMessage, data: createErrorResponse(code, message) })
}

function notFound(message: string): never {
  return importHttpError(404, 'Not Found', ErrorCode.NOT_FOUND, message)
}

function conflict(message: string): never {
  return importHttpError(409, 'Conflict', ErrorCode.CONFLICT, message)
}

function badRequest(message: string): never {
  return importHttpError(400, 'Bad Request', ErrorCode.VALIDATION_ERROR, message)
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** Resolves a product by slug or id inside the project; the default product when absent. */
export async function resolveImportProduct(projectId: string, product?: string | null) {
  if (!product) return requireProductInProject(projectId)
  const products = await listProducts(projectId)
  const found = products.find((p) => p.id === product || p.slug === product)
  if (!found) notFound('Product not found')
  return found
}

export async function createImportRun(input: {
  projectId: string
  productId: string
  userId: string
  source: string
  sourceLabel: string
  onExisting?: 'sync' | 'skip'
}): Promise<ImportRunRow> {
  const now = new Date()
  const [run] = await db
    .insert(importRun)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      productId: input.productId,
      createdByUserId: input.userId,
      source: input.source,
      sourceLabel: input.sourceLabel,
      onExisting: input.onExisting ?? 'sync',
      status: 'draft',
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return run!
}

export async function getImportRunForProject(projectId: string, runId: string): Promise<ImportRunRow> {
  const [run] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, runId), eq(importRun.projectId, projectId)))
    .limit(1)
  if (!run) notFound('Import run not found')
  return run
}

export async function listImportRuns(projectId: string, limit = 50): Promise<ImportRunRow[]> {
  return db
    .select()
    .from(importRun)
    .where(eq(importRun.projectId, projectId))
    .orderBy(desc(importRun.createdAt))
    .limit(limit)
}

export async function listImportIssues(runId: string, limit = 200) {
  return db
    .select()
    .from(importRunIssue)
    .where(eq(importRunIssue.runId, runId))
    .orderBy(asc(importRunIssue.createdAt), asc(importRunIssue.id))
    .limit(limit)
}

export async function addImportBatch(
  runId: string,
  batch: ImportBatch
): Promise<{ seq: number; recordCount: number; runRecordCount: number; issues: IssueInput[] }> {
  const [run] = await db.select().from(importRun).where(eq(importRun.id, runId)).limit(1)
  if (!run) notFound('Import run not found')
  if (run.status !== 'draft') {
    conflict(`Import run is ${run.status}; only draft runs accept records`)
  }

  const incoming = countRecords(batch)
  if (incoming > MAX_BATCH_RECORDS) {
    badRequest(`A batch holds at most ${MAX_BATCH_RECORDS} records (got ${incoming})`)
  }
  if (run.recordCount + incoming > MAX_RUN_RECORDS) {
    badRequest(`A run holds at most ${MAX_RUN_RECORDS} records`)
  }

  const earlier = await db
    .select({ seq: importRunBatch.seq, payload: importRunBatch.payload })
    .from(importRunBatch)
    .where(eq(importRunBatch.runId, runId))

  const issues: IssueInput[] = []
  const staged: Record<string, any[]> = {}
  for (const [section, entityType] of SECTIONS) {
    const seen = new Set<string>()
    for (const prior of earlier) {
      for (const rec of (prior.payload?.[section] ?? []) as { externalId: string }[]) seen.add(rec.externalId)
    }
    staged[section] = []
    for (const rec of batch[section] as { externalId: string }[]) {
      if (seen.has(rec.externalId)) {
        issues.push({
          severity: 'skipped',
          entityType,
          externalId: rec.externalId,
          message: `Duplicate ${entityType} externalId "${rec.externalId}" in this run; the later record was dropped`,
        })
        continue
      }
      seen.add(rec.externalId)
      staged[section].push(rec)
    }
  }

  const kept = countRecords(staged as unknown as ImportBatch)
  const seq = earlier.reduce((max, b) => Math.max(max, b.seq), 0) + 1
  const runRecordCount = run.recordCount + kept
  const now = new Date()

  const retry = 'Run changed concurrently; retry the batch'
  try {
    await db.transaction(async (tx) => {
      // Conditional on the state we validated against: a concurrent batch or a status change matches no row.
      const [updated] = await tx
        .update(importRun)
        .set({ recordCount: runRecordCount, updatedAt: now })
        .where(and(eq(importRun.id, runId), eq(importRun.status, 'draft'), eq(importRun.recordCount, run.recordCount)))
        .returning({ id: importRun.id })
      if (!updated) conflict(retry)

      await tx.insert(importRunBatch).values({
        id: crypto.randomUUID(),
        runId,
        seq,
        payload: staged,
        recordCount: kept,
        createdAt: now,
      })
      if (issues.length) {
        await tx.insert(importRunIssue).values(
          issues.map((issue) => ({
            id: crypto.randomUUID(),
            runId,
            severity: issue.severity,
            entityType: issue.entityType,
            externalId: issue.externalId ?? null,
            message: issue.message,
            createdAt: now,
          }))
        )
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) conflict(retry)
    throw error
  }

  return { seq, recordCount: kept, runRecordCount, issues }
}

export async function cancelImportRun(runId: string): Promise<ImportRunRow> {
  const [run] = await db.select().from(importRun).where(eq(importRun.id, runId)).limit(1)
  if (!run) notFound('Import run not found')
  if (run.status !== 'draft' && run.status !== 'committing') {
    conflict(`Import run is ${run.status}; it cannot be canceled`)
  }
  // Compare-and-swap on the status just read, so a concurrent completion is not overwritten.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(importRun)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(and(eq(importRun.id, runId), eq(importRun.status, run.status)))
      .returning()
    // The staged records hold personal data; a finished run does not keep them.
    if (row) await tx.delete(importRunBatch).where(eq(importRunBatch.runId, runId))
    return row
  })
  if (!updated) {
    conflict('Import run changed state; it cannot be canceled')
  }
  return updated
}
