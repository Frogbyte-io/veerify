import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { changelogEntry, changelogEntryFeedback, changelogEntryProduct } from '~/server/database/schema/changelog'
import { feedback, product } from '~/server/database/schema/feedback'
import { requirePublicProduct, resolvePublicProject } from '~/server/utils/project-access'
import { isModuleEnabledForProject } from '~/server/utils/public-modules'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { renderMarkdown } from '~/server/utils/markdown'
import type { ChangelogEntryRow } from './hooks'

export const PUBLIC_PAGE_SIZE = 20
export const RSS_ITEM_LIMIT = 30

/**
 * Resolves a public project and requires the changelog tool on for it. A
 * disabled changelog answers 404 (indistinguishable from none).
 */
export async function resolvePublicChangelogProject(orgSlug: string, projectSlug: string) {
  const resolved = await resolvePublicProject(orgSlug, projectSlug)
  if (!isModuleEnabledForProject(resolved.project.settings as Record<string, unknown> | null, 'changelogEnabled')) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog is not available for this project'),
    })
  }
  return resolved
}

/**
 * Entries visible on the public changelog: untagged (whole project), or tagged
 * with at least one public product. Entries tagged only with private products
 * are excluded. With `productId`, additionally restricts to entries tagged with
 * that product or untagged.
 */
function publicEntryVisibility(projectId: string, productId?: string) {
  const untagged = sql`not exists (select 1 from ${changelogEntryProduct} where ${changelogEntryProduct.entryId} = ${changelogEntry.id})`
  const taggedPublic = sql`exists (select 1 from ${changelogEntryProduct} inner join ${product} on ${product.id} = ${changelogEntryProduct.productId} where ${changelogEntryProduct.entryId} = ${changelogEntry.id} and ${product.isPublic} = true)`
  const conditions = [or(untagged, taggedPublic)!]
  if (productId) {
    const taggedWith = sql`exists (select 1 from ${changelogEntryProduct} where ${changelogEntryProduct.entryId} = ${changelogEntry.id} and ${changelogEntryProduct.productId} = ${productId})`
    conditions.push(or(taggedWith, untagged)!)
  }
  return and(eq(changelogEntry.projectId, projectId), ...conditions)!
}

/** Resolves the optional `?product=<slug>` filter; private/unknown products 404. */
export async function resolvePublicChangelogProductFilter(
  proj: Parameters<typeof requirePublicProduct>[0],
  productSlug?: string
) {
  if (!productSlug) return undefined
  return (await requirePublicProduct(proj, productSlug)).id
}

/** Public product ids each entry is tagged with (private products are never exposed). */
async function loadPublicProductIds(entryIds: string[]) {
  const byEntry = new Map<string, string[]>()
  if (entryIds.length === 0) return byEntry
  const rows = await db
    .select({ entryId: changelogEntryProduct.entryId, productId: changelogEntryProduct.productId })
    .from(changelogEntryProduct)
    .innerJoin(product, eq(changelogEntryProduct.productId, product.id))
    .where(and(inArray(changelogEntryProduct.entryId, entryIds), eq(product.isPublic, true)))
  for (const row of rows) {
    const list = byEntry.get(row.entryId) ?? []
    list.push(row.productId)
    byEntry.set(row.entryId, list)
  }
  return byEntry
}

/** Visible (non-hidden, non-support-conversation) feedback titles per entry. */
async function loadPublicFeedback(entryIds: string[]) {
  const byEntry = new Map<string, Array<{ id: string; title: string }>>()
  if (entryIds.length === 0) return byEntry
  const rows = await db
    .select({
      entryId: changelogEntryFeedback.entryId,
      id: feedback.id,
      title: feedback.title,
      isHidden: feedback.isHidden,
      metadata: feedback.metadata,
    })
    .from(changelogEntryFeedback)
    .innerJoin(feedback, eq(changelogEntryFeedback.feedbackId, feedback.id))
    .where(inArray(changelogEntryFeedback.entryId, entryIds))
  for (const row of rows) {
    if (row.isHidden || (row.metadata as { source?: string } | null)?.source === 'support_conversation') continue
    const list = byEntry.get(row.entryId) ?? []
    list.push({ id: row.id, title: row.title })
    byEntry.set(row.entryId, list)
  }
  return byEntry
}

function serializePublicEntry(
  row: ChangelogEntryRow,
  linked: Array<{ id: string; title: string }> | undefined,
  productIds: string[] | undefined
) {
  return {
    id: row.id,
    productIds: productIds ?? [],
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    labels: row.labels,
    publishedAt: row.publishedAt,
    // Sanitised by renderMarkdown (allowlist + safe URL schemes)
    html: renderMarkdown(row.body),
    feedback: linked ?? [],
  }
}

export async function listPublishedEntries(
  projectId: string,
  options: { cursor?: string; limit?: number; productId?: string } = {}
) {
  const limit = options.limit ?? PUBLIC_PAGE_SIZE
  const conditions = [publicEntryVisibility(projectId, options.productId), eq(changelogEntry.status, 'published')]
  if (options.cursor) {
    // publishedAt is carried in the cursor's createdAt slot
    const cursor = decodeListCursor(options.cursor, 'changelog')
    conditions.push(
      or(
        lt(changelogEntry.publishedAt, cursor.createdAt),
        and(eq(changelogEntry.publishedAt, cursor.createdAt), lt(changelogEntry.id, cursor.id))
      )!
    )
  }
  const rows = await db
    .select()
    .from(changelogEntry)
    .where(and(...conditions))
    .orderBy(desc(changelogEntry.publishedAt), desc(changelogEntry.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > limit && last?.publishedAt ? encodeListCursor({ createdAt: last.publishedAt, id: last.id }) : null
  const pageIds = page.map((row) => row.id)
  const linked = await loadPublicFeedback(pageIds)
  const productIds = await loadPublicProductIds(pageIds)
  return {
    rows: page,
    entries: page.map((row) => serializePublicEntry(row, linked.get(row.id), productIds.get(row.id))),
    nextCursor,
  }
}

export async function findPublishedEntryBySlug(projectId: string, slug: string) {
  const [row] = await db
    .select()
    .from(changelogEntry)
    .where(and(publicEntryVisibility(projectId), eq(changelogEntry.slug, slug), eq(changelogEntry.status, 'published')))
    .limit(1)
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog entry not found'),
    })
  }
  const linked = await loadPublicFeedback([row.id])
  const productIds = await loadPublicProductIds([row.id])
  return serializePublicEntry(row, linked.get(row.id), productIds.get(row.id))
}
