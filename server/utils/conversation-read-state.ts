import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversationReadState } from '~/server/database/schema/support'

interface ConversationUnreadInput {
  assigneeUserId: string | null
  createdAt: Date
  lastCustomerReplyAt: Date | null
  lastAgentReplyAt: Date | null
  lastReadAt: Date | null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * A conversation is unread when its customer-facing unread signal is newer
 * than this agent's cursor. Creation is the initial signal, so a newly created
 * unclaimed ticket enters the shared queue even before a message is attached.
 *
 * Once another agent owns and has replied to the conversation, handled-ness
 * wins over the viewer's cursor: it is no longer part of this agent's queue.
 */
export function isConversationUnread(row: ConversationUnreadInput, userId: string): boolean {
  const handledByAnotherAgent = Boolean(row.assigneeUserId && row.assigneeUserId !== userId && row.lastAgentReplyAt)
  if (handledByAnotherAgent) return false

  const unreadSignalAt = row.lastCustomerReplyAt ?? row.createdAt
  return row.lastReadAt === null || row.lastReadAt.getTime() < unreadSignalAt.getTime()
}

/**
 * Persist the viewer's read cursor, or remove it to explicitly mark unread.
 * The unique pair makes repeated and concurrent read requests idempotent.
 */
export async function setConversationReadState(
  conversationId: string,
  userId: string,
  isUnread: boolean,
  now = new Date()
) {
  if (isUnread) {
    await db
      .delete(conversationReadState)
      .where(and(eq(conversationReadState.conversationId, conversationId), eq(conversationReadState.userId, userId)))
    return null
  }

  const [stored] = await db
    .insert(conversationReadState)
    .values({ conversationId, userId, lastReadAt: now })
    .onConflictDoUpdate({
      target: [conversationReadState.userId, conversationReadState.conversationId],
      set: { lastReadAt: now },
    })
    .returning()

  return stored
}

/**
 * An incoming customer message invalidates read cursors at the queue boundary:
 * every agent while unclaimed, or only the owner after assignment.
 */
export async function reMarkConversationUnreadForIncoming(
  tx: Tx,
  conversationId: string,
  assigneeUserId: string | null
) {
  const conditions = [eq(conversationReadState.conversationId, conversationId)]
  if (assigneeUserId) conditions.push(eq(conversationReadState.userId, assigneeUserId))
  await tx.delete(conversationReadState).where(and(...conditions))
}
