import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversation } from '~/server/database/schema/support'
import { recordConversationActivity } from '~/server/utils/conversation-activity'

export interface ConversationClaimResult {
  claimed: boolean
  conversation: typeof conversation.$inferSelect | null
}

/**
 * Claim a conversation only while it is unassigned. The predicate is applied
 * by Postgres inside the transaction, so concurrent agents cannot both win or
 * produce duplicate assignment activity.
 */
export async function claimConversationForAgent(
  conversationId: string,
  userId: string,
  now = new Date()
): Promise<ConversationClaimResult> {
  return db.transaction(async (tx) => {
    const [claimedConversation] = await tx
      .update(conversation)
      .set({ assigneeUserId: userId, lastActivityAt: now, updatedAt: now })
      .where(and(eq(conversation.id, conversationId), isNull(conversation.assigneeUserId)))
      .returning()

    if (claimedConversation) {
      await recordConversationActivity(
        tx,
        conversationId,
        [{ field: 'assigneeUserId', from: null, to: userId }],
        userId
      )
      return { claimed: true, conversation: claimedConversation }
    }

    const [currentConversation] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .limit(1)

    return { claimed: false, conversation: currentConversation ?? null }
  })
}
