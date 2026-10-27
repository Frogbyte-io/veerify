/**
 * Deletion tombstones for imported records. When the team deletes imported feedback or an imported comment in Veerify,
 * the delete route records `(projectId, entity, source, externalId)` in `import_tombstone`; the commit and the preview
 * then skip that record ("Deleted in Veerify") instead of re-creating it on the next sync. Comments are identified by
 * their feedback's externalId and their own (see `commentTombstoneId`).
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { importTombstone, type ImportTombstoneEntity } from '~/server/database/schema/imports'
import { commentKey } from './format'

export const DELETED_IN_VEERIFY = 'Deleted in Veerify'

type Executor = Pick<typeof db, 'select' | 'insert'>

export function commentTombstoneId(feedbackExternalId: string, externalId: string): string {
  return JSON.stringify([feedbackExternalId, externalId])
}

/** Records that an imported row was deleted. A no-op for rows that did not come from an import. */
export async function recordImportTombstone(
  executor: Executor,
  input: { projectId: string; entity: ImportTombstoneEntity; source: string | null; externalId: string | null }
): Promise<void> {
  if (!input.source || !input.externalId) return
  await executor
    .insert(importTombstone)
    .values({
      projectId: input.projectId,
      entity: input.entity,
      source: input.source,
      externalId: input.externalId,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
}

/**
 * Tombstoned externalIds of a project and source. Feedback: externalIds. Comments: `commentKey(feedback, comment)`.
 */
export async function loadTombstones(
  projectId: string,
  source: string,
  entity: ImportTombstoneEntity,
  executor: Pick<typeof db, 'select'> = db
): Promise<Set<string>> {
  const rows = await executor
    .select({ externalId: importTombstone.externalId })
    .from(importTombstone)
    .where(
      and(
        eq(importTombstone.projectId, projectId),
        eq(importTombstone.source, source),
        eq(importTombstone.entity, entity)
      )
    )
  if (entity === 'feedback') return new Set(rows.map((r) => r.externalId))
  const keys = new Set<string>()
  for (const { externalId } of rows) {
    try {
      const [feedbackExternalId, commentExternalId] = JSON.parse(externalId) as [string, string]
      keys.add(commentKey(feedbackExternalId, commentExternalId))
    } catch {
      // Not written by commentTombstoneId; ignore.
    }
  }
  return keys
}

/** Whether one record is tombstoned, read inside the record's transaction (catches a delete during the commit). */
export async function isTombstoned(
  executor: Pick<typeof db, 'select'>,
  input: { projectId: string; entity: ImportTombstoneEntity; source: string; externalId: string }
): Promise<boolean> {
  const [row] = await executor
    .select({ externalId: importTombstone.externalId })
    .from(importTombstone)
    .where(
      and(
        eq(importTombstone.projectId, input.projectId),
        eq(importTombstone.entity, input.entity),
        eq(importTombstone.source, input.source),
        eq(importTombstone.externalId, input.externalId)
      )
    )
    .limit(1)
  return !!row
}
