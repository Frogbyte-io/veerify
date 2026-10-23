import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  changelogEntry,
  changelogEntryFeedback,
  changelogEntryProduct,
  type ChangelogEntryStatus,
  type ChangelogLabel,
} from '~/server/database/schema/changelog'
import { feedback, product } from '~/server/database/schema/feedback'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { generateUniqueSlug } from './slug'
import { runChangelogPublishedHooks, type ChangelogEntryRow } from './hooks'

export const CHANGELOG_LABELS = ['new', 'improved', 'fixed'] as const satisfies readonly ChangelogLabel[]
export const MAX_SUMMARY_LENGTH = 280
export const MAX_BODY_LENGTH = 50_000
export const MAX_LINKED_FEEDBACK = 50
export const DEFAULT_PAGE_SIZE = 20

function httpError(statusCode: number, statusMessage: string, code: string, message: string): never {
  throw createError({ statusCode, statusMessage, data: createErrorResponse(code, message) })
}

export function notFound(message = 'Changelog entry not found'): never {
  return httpError(404, 'Not Found', ErrorCode.NOT_FOUND, message)
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

export function serializeEntry(row: ChangelogEntryRow, productIds: string[]) {
  return {
    id: row.id,
    productIds,
    projectId: row.projectId,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    status: row.status,
    labels: row.labels,
    publishedAt: row.publishedAt,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Product ids each entry is tagged with. Entries with no tag apply to the whole project. */
export async function loadEntryProductIds(entryIds: string[]): Promise<Map<string, string[]>> {
  const byEntry = new Map<string, string[]>()
  if (entryIds.length === 0) return byEntry
  const rows = await db
    .select({ entryId: changelogEntryProduct.entryId, productId: changelogEntryProduct.productId })
    .from(changelogEntryProduct)
    .where(inArray(changelogEntryProduct.entryId, entryIds))
  for (const row of rows) {
    const list = byEntry.get(row.entryId) ?? []
    list.push(row.productId)
    byEntry.set(row.entryId, list)
  }
  return byEntry
}

export async function getEntryProductIds(entryId: string): Promise<string[]> {
  return (await loadEntryProductIds([entryId])).get(entryId) ?? []
}

export async function findEntry(projectId: string, entryId: string): Promise<ChangelogEntryRow> {
  const [row] = await db
    .select()
    .from(changelogEntry)
    .where(and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId)))
    .limit(1)
  if (!row) notFound()
  return row
}

/** Entries tagged with the product, or untagged (applying to the whole project). */
export function taggedWithOrUntagged(productId: string) {
  return sql`(exists (select 1 from ${changelogEntryProduct} where ${changelogEntryProduct.entryId} = ${changelogEntry.id} and ${changelogEntryProduct.productId} = ${productId}) or not exists (select 1 from ${changelogEntryProduct} where ${changelogEntryProduct.entryId} = ${changelogEntry.id}))`
}

export async function listEntries(
  projectId: string,
  options: { status?: ChangelogEntryStatus; productId?: string; cursor?: string; limit?: number }
) {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), 100)
  const conditions = [eq(changelogEntry.projectId, projectId)]
  if (options.status) conditions.push(eq(changelogEntry.status, options.status))
  if (options.productId) conditions.push(taggedWithOrUntagged(options.productId))
  if (options.cursor) {
    const cursor = decodeListCursor(options.cursor, 'changelog')
    conditions.push(
      or(
        lt(changelogEntry.createdAt, cursor.createdAt),
        and(eq(changelogEntry.createdAt, cursor.createdAt), lt(changelogEntry.id, cursor.id))
      )!
    )
  }

  const rows = await db
    .select()
    .from(changelogEntry)
    .where(and(...conditions))
    .orderBy(desc(changelogEntry.createdAt), desc(changelogEntry.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = rows.length > limit && last ? encodeListCursor({ createdAt: last.createdAt, id: last.id }) : null
  return { entries: page, nextCursor }
}

/**
 * Throws 400 unless every id is feedback of `projectId`. Prevents linking
 * another project's feedback (and leaking its titles on the public page).
 */
export async function assertFeedbackInProject(projectId: string, feedbackIds: string[]) {
  if (feedbackIds.length === 0) return
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), inArray(feedback.id, feedbackIds)))
  if (rows.length !== new Set(feedbackIds).size) {
    httpError(400, 'Bad Request', ErrorCode.VALIDATION_ERROR, 'Linked feedback must belong to this project')
  }
}

/** Throws 400 unless every id is a product of `projectId`. */
export async function assertProductsInProject(projectId: string, productIds: string[]) {
  if (productIds.length === 0) return
  const rows = await db
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.projectId, projectId), inArray(product.id, productIds)))
  if (rows.length !== new Set(productIds).size) {
    httpError(400, 'Bad Request', ErrorCode.VALIDATION_ERROR, 'Products must belong to this project')
  }
}

type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>

async function replaceLinkedFeedback(executor: Executor, entryId: string, feedbackIds: string[]) {
  await executor.delete(changelogEntryFeedback).where(eq(changelogEntryFeedback.entryId, entryId))
  if (feedbackIds.length > 0) {
    await executor
      .insert(changelogEntryFeedback)
      .values([...new Set(feedbackIds)].map((feedbackId) => ({ entryId, feedbackId })))
  }
}

async function replaceEntryProducts(executor: Executor, entryId: string, productIds: string[]) {
  await executor.delete(changelogEntryProduct).where(eq(changelogEntryProduct.entryId, entryId))
  if (productIds.length > 0) {
    await executor
      .insert(changelogEntryProduct)
      .values([...new Set(productIds)].map((productId) => ({ entryId, productId })))
  }
}

export async function getLinkedFeedback(entryId: string) {
  return db
    .select({ id: feedback.id, title: feedback.title, status: feedback.status })
    .from(changelogEntryFeedback)
    .innerJoin(feedback, eq(changelogEntryFeedback.feedbackId, feedback.id))
    .where(eq(changelogEntryFeedback.entryId, entryId))
}

export interface EntryInput {
  title: string
  summary?: string | null
  body?: string
  labels?: ChangelogLabel[]
  feedbackIds?: string[]
  /** Products the entry applies to; empty/omitted = the whole project */
  productIds?: string[]
}

export async function createEntry(projectId: string, authorUserId: string, input: EntryInput) {
  await assertFeedbackInProject(projectId, input.feedbackIds ?? [])
  await assertProductsInProject(projectId, input.productIds ?? [])

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await generateUniqueSlug(projectId, input.title)
    const now = new Date()
    try {
      // Entry and its feedback links commit together (or not at all)
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(changelogEntry)
          .values({
            id: randomUUID(),
            projectId,
            title: input.title,
            slug,
            summary: input.summary ?? null,
            body: input.body ?? '',
            labels: input.labels ?? [],
            status: 'draft',
            authorUserId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        if (input.feedbackIds?.length) await replaceLinkedFeedback(tx, row.id, input.feedbackIds)
        if (input.productIds?.length) await replaceEntryProducts(tx, row.id, input.productIds)
        return row
      })
    } catch (error) {
      // Concurrent create took the slug between lookup and insert: retry
      if (!isUniqueViolation(error)) throw error
    }
  }
  return httpError(409, 'Conflict', ErrorCode.CONFLICT, 'Could not generate a unique slug, try again')
}

export async function updateEntry(projectId: string, entryId: string, input: Partial<EntryInput>) {
  await findEntry(projectId, entryId)
  if (input.feedbackIds !== undefined) await assertFeedbackInProject(projectId, input.feedbackIds)
  if (input.productIds !== undefined) await assertProductsInProject(projectId, input.productIds)

  const patch: Partial<typeof changelogEntry.$inferInsert> = { updatedAt: new Date() }
  if (input.title !== undefined) patch.title = input.title
  if (input.summary !== undefined) patch.summary = input.summary
  if (input.body !== undefined) patch.body = input.body
  if (input.labels !== undefined) patch.labels = input.labels

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(changelogEntry)
      .set(patch)
      .where(and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId)))
      .returning()
    if (!row) notFound()
    if (input.feedbackIds !== undefined) await replaceLinkedFeedback(tx, entryId, input.feedbackIds)
    if (input.productIds !== undefined) await replaceEntryProducts(tx, entryId, input.productIds)
    return row
  })
}

export async function deleteEntry(projectId: string, entryId: string) {
  await findEntry(projectId, entryId)
  await db.delete(changelogEntry).where(and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId)))
}

/**
 * Publishes a draft. Already-published entries are returned unchanged and do
 * not re-run hooks (so repeated clicks or concurrent requests never
 * double-trigger review requests): the draft to published transition is a single
 * conditional UPDATE, and only the request that wins it runs the hooks.
 */
export async function publishEntry(projectId: string, entryId: string) {
  const existing = await findEntry(projectId, entryId)
  if (existing.status === 'published') return existing

  if (!existing.body.trim() && !existing.summary?.trim()) {
    httpError(400, 'Bad Request', ErrorCode.VALIDATION_ERROR, 'Add a summary or body before publishing')
  }

  const now = new Date()
  const [row] = await db
    .update(changelogEntry)
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where(
      and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId), eq(changelogEntry.status, 'draft'))
    )
    .returning()
  // Lost the race to a concurrent publish: return the current entry, no hooks
  if (!row) return findEntry(projectId, entryId)

  await runChangelogPublishedHooks(row)
  return row
}

export async function unpublishEntry(projectId: string, entryId: string) {
  const existing = await findEntry(projectId, entryId)
  if (existing.status === 'draft') return existing

  const [row] = await db
    .update(changelogEntry)
    .set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
    .where(and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId)))
    .returning()
  if (!row) notFound()
  return row
}
