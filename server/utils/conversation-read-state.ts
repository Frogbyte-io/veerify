import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversation, conversationReadState } from '~/server/database/schema/support'

interface ConversationUnreadInput {
  assigneeUserId: string | null
  createdAt: Date
  lastCustomerReplyAt: Date | null
  lastAgentReplyAt: Date | null
  lastReadAt: Date | null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type LockedConversation = Pick<
  typeof conversation.$inferSelect,
  'assigneeUserId' | 'createdAt' | 'lastCustomerReplyAt' | 'lastAgentReplyAt'
>

export interface ConversationReadStateResult {
  conversation: LockedConversation
  readState: typeof conversationReadState.$inferSelect | null
}

/**
 * A conversation is unread when its customer-facing unread signal is newer
 * than this agent's cursor. Creation is the initial signal, so a newly created
 * unclaimed ticket enters the shared queue even before a message is attached.
 *
 * Once another agent owns the conversation, ownership wins over the viewer's
 * cursor: it is no longer part of this agent's queue.
 */
export function isConversationUnread(row: ConversationUnreadInput, userId: string): boolean {
  const ownedByAnotherAgent = Boolean(row.assigneeUserId && row.assigneeUserId !== userId)
  if (ownedByAnotherAgent) return false

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
  observedCustomerSignalAt?: Date
): Promise<ConversationReadStateResult> {
  return db.transaction((tx) =>
    setConversationReadStateInTransaction(tx, conversationId, userId, isUnread, observedCustomerSignalAt)
  )
}

/**
 * Lock the conversation before changing a cursor so inbound ingestion and a
 * read request agree on the order of their signals. The caller supplies the
 * customer signal it actually observed before this mutation; retaining that
 * signal (rather than substituting wall-clock time) means an inbound reply
 * that wins the race remains unread.
 */
export async function setConversationReadStateInTransaction(
  tx: Tx,
  conversationId: string,
  userId: string,
  isUnread: boolean,
  observedCustomerSignalAt?: Date
): Promise<ConversationReadStateResult> {
  const [lockedConversation] = await tx
    .select({
      assigneeUserId: conversation.assigneeUserId,
      createdAt: conversation.createdAt,
      lastCustomerReplyAt: conversation.lastCustomerReplyAt,
      lastAgentReplyAt: conversation.lastAgentReplyAt,
    })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .for('update')

  if (!lockedConversation) {
    throw new Error(`Conversation ${conversationId} vanished before its read state could be updated`)
  }

  if (isUnread) {
    await tx
      .delete(conversationReadState)
      .where(and(eq(conversationReadState.conversationId, conversationId), eq(conversationReadState.userId, userId)))
    return { conversation: lockedConversation, readState: null }
  }

  const lastReadAt = observedCustomerSignalAt ?? lockedConversation.lastCustomerReplyAt ?? lockedConversation.createdAt

  const [stored] = await tx
    .insert(conversationReadState)
    .values({ conversationId, userId, lastReadAt })
    .onConflictDoUpdate({
      target: [conversationReadState.userId, conversationReadState.conversationId],
      set: { lastReadAt: sql`greatest(${conversationReadState.lastReadAt}, excluded.last_read_at)` },
    })
    .returning()

  return { conversation: lockedConversation, readState: stored }
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
