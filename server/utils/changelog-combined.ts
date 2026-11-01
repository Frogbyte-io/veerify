// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogEntry, type ChangelogEntryStatus } from '~/server/database/schema/changelog'
import { decodeListCursor, encodeListCursor } from './list-cursor'

export const COMBINED_DEFAULT_PAGE_SIZE = 20

/**
 * One timeline across projects, newest first (same order and cursor as the per-project list, so a
 * page of the combined list is the merge of the per-project pages). Drafts are included.
 */
export async function listEntriesAcrossProjects(
  projectIds: string[],
  options: { status?: ChangelogEntryStatus; cursor?: string; limit?: number }
) {
  if (projectIds.length === 0) return { entries: [], nextCursor: null }
  const limit = Math.min(Math.max(options.limit ?? COMBINED_DEFAULT_PAGE_SIZE, 1), 100)
  const conditions = [inArray(changelogEntry.projectId, projectIds)]
  if (options.status) conditions.push(eq(changelogEntry.status, options.status))
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
