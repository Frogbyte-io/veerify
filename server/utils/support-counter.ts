import { eq } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { supportCounter } from '~/server/database/schema/support'

/**
 * `displayId` allocation for conversations (delta-free, matches `design.md` →
 * Data model → Stage 02 exactly: `SELECT … FOR UPDATE` on a per-project counter
 * row, not a sequence, because the number must be per-project and gap-free
 * enough to read as a ticket number like Zendesk's).
 *
 * Must be called inside the same transaction as the conversation insert — the
 * row lock only holds for the lifetime of that transaction, and a caller that
 * allocates outside it could hand out an id that a concurrent transaction
 * also allocates.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function allocateConversationDisplayId(tx: Tx, projectId: string): Promise<number> {
  const [existing] = await tx.select().from(supportCounter).where(eq(supportCounter.projectId, projectId)).for('update')

  if (existing) {
    await tx
      .update(supportCounter)
      .set({ nextConversationDisplayId: existing.nextConversationDisplayId + 1 })
      .where(eq(supportCounter.projectId, projectId))

    return existing.nextConversationDisplayId
  }

  // No counter row yet for this project. Claim displayId 1 by creating one -
  // `onConflictDoNothing` handles two transactions racing to create the same
  // project's row: at most one INSERT survives, so at most one caller returns
  // here. Postgres blocks the loser's INSERT on the winner's uncommitted row
  // until the winner commits, so the loser's fallthrough re-select below is
  // guaranteed to see it.
  const inserted = await tx
    .insert(supportCounter)
    .values({ projectId, nextConversationDisplayId: 2 })
    .onConflictDoNothing()
    .returning({ projectId: supportCounter.projectId })

  if (inserted.length > 0) {
    return 1
  }

  const [row] = await tx.select().from(supportCounter).where(eq(supportCounter.projectId, projectId)).for('update')

  if (!row) {
    throw new Error(`support_counter row for project ${projectId} vanished between insert and re-select`)
  }

  await tx
    .update(supportCounter)
    .set({ nextConversationDisplayId: row.nextConversationDisplayId + 1 })
    .where(eq(supportCounter.projectId, projectId))

  return row.nextConversationDisplayId
}
