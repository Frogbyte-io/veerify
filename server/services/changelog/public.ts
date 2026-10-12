import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { changelogEntry, changelogEntryFeedback } from '~/server/database/schema/changelog'
import { feedback } from '~/server/database/schema/feedback'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { isTeamModuleEnabled } from '~/server/utils/public-modules'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { renderMarkdown } from '~/server/utils/markdown'
import type { ChangelogEntryRow } from './hooks'

export const PUBLIC_PAGE_SIZE = 20
export const RSS_ITEM_LIMIT = 30

/**
 * Resolves a public product and requires the changelog module on for both the
 * product (`changelogEnabled`) and the team. A disabled changelog answers 404
 * (indistinguishable from none).
 */
export async function resolvePublicChangelogProject(teamSlug: string, projectSlug: string) {
  const resolved = await resolvePublicProjectByTeam(teamSlug, projectSlug)
  const settings = resolved.project.settings as Record<string, unknown> | null
  if (settings?.changelogEnabled !== true || !(await isTeamModuleEnabled(resolved.team.id, 'changelogEnabled'))) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog is not available for this product'),
    })
  }
  return resolved
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

function serializePublicEntry(row: ChangelogEntryRow, linked: Array<{ id: string; title: string }> | undefined) {
  return {
    id: row.id,
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

export async function listPublishedEntries(projectId: string, options: { cursor?: string; limit?: number } = {}) {
  const limit = options.limit ?? PUBLIC_PAGE_SIZE
  const conditions = [eq(changelogEntry.projectId, projectId), eq(changelogEntry.status, 'published')]
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
  const linked = await loadPublicFeedback(page.map((row) => row.id))
  return { rows: page, entries: page.map((row) => serializePublicEntry(row, linked.get(row.id))), nextCursor }
}

export async function findPublishedEntryBySlug(projectId: string, slug: string) {
  const [row] = await db
    .select()
    .from(changelogEntry)
    .where(
      and(
        eq(changelogEntry.projectId, projectId),
        eq(changelogEntry.slug, slug),
        eq(changelogEntry.status, 'published')
      )
    )
    .limit(1)
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog entry not found'),
    })
  }
  const linked = await loadPublicFeedback([row.id])
  return serializePublicEntry(row, linked.get(row.id))
}
