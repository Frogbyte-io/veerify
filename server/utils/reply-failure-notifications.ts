/**
 * Tell the agent who wrote a support reply that it finally failed: the outbox
 * gave up (terminal `failed`, including an abandoned final attempt) or the
 * recipient's server hard-bounced it. In-app notification (bell + realtime),
 * through `notifyUser`, so the user's in-app switch applies.
 *
 * Idempotent per failure: a guarded update stamps
 * `conversation_message.metadata.replyFailureNotifiedAt` and only the caller
 * that set it notifies, so a redelivered webhook, a racing worker or a second
 * bounce event never sends a second one. An agent's Retry clears the stamp
 * (`clearReplyFailureNotification`), so a retry that fails again notifies again.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversation, conversationMessage } from '~/server/database/schema/support'
import { notifyUser } from '~/server/utils/notifications'
import { createLogger } from '~/server/utils/logger'
import { describeDeliveryFailure } from '~/lib/support-delivery-errors'

const logger = createLogger('reply-failure-notifications')

const MARKER = 'replyFailureNotifiedAt'

export interface ReplyFailureClaim {
  senderUserId: string
  conversationId: string
  deliveryStatus: string
  deliveryError: string | null
}

/** Stamp the marker on a finally failed agent reply; null when there is nothing (more) to notify. */
async function claimReplyFailureNotification(messageId: string, now: Date): Promise<ReplyFailureClaim | null> {
  const [row] = await db
    .update(conversationMessage)
    .set({
      metadata: sql`coalesce(${conversationMessage.metadata}, '{}'::jsonb) || jsonb_build_object(${MARKER}::text, ${now.toISOString()}::text)`,
    })
    .where(
      and(
        eq(conversationMessage.id, messageId),
        eq(conversationMessage.kind, 'outgoing'),
        isNotNull(conversationMessage.senderUserId),
        inArray(conversationMessage.deliveryStatus, ['failed', 'bounced']),
        sql`(${conversationMessage.metadata} ->> ${MARKER}::text) is null`
      )
    )
    .returning({
      senderUserId: conversationMessage.senderUserId,
      conversationId: conversationMessage.conversationId,
      deliveryStatus: conversationMessage.deliveryStatus,
      deliveryError: conversationMessage.deliveryError,
    })
  if (!row?.senderUserId) return null
  return { ...row, senderUserId: row.senderUserId }
}

export interface NotifyReplyFailedDeps {
  now?: Date
  claim?: (messageId: string, now: Date) => Promise<ReplyFailureClaim | null>
  loadConversation?: (conversationId: string) => Promise<{ displayId: number | null; subject: string | null } | null>
  notify?: typeof notifyUser
}

async function defaultLoadConversation(conversationId: string) {
  const [row] = await db
    .select({ displayId: conversation.displayId, subject: conversation.subject })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .limit(1)
  return row ?? null
}

/** Notify the replying agent once per failure. Never throws; returns whether a notification was created. */
export async function notifyReplyFailed(messageId: string, deps: NotifyReplyFailedDeps = {}): Promise<boolean> {
  try {
    const now = deps.now ?? new Date()
    const claimed = await (deps.claim ?? claimReplyFailureNotification)(messageId, now)
    if (!claimed) return false

    const thread = await (deps.loadConversation ?? defaultLoadConversation)(claimed.conversationId)
    const label = thread?.displayId ? `conversation #${thread.displayId}` : 'a conversation'
    const bounced = claimed.deliveryStatus === 'bounced'
    const reason = describeDeliveryFailure(claimed.deliveryError).message
    const created = await (deps.notify ?? notifyUser)(claimed.senderUserId, {
      type: 'reply_failed',
      title: bounced ? `Your reply in ${label} bounced` : `Your reply in ${label} was not sent`,
      body: thread?.subject ? `${thread.subject} · ${reason}` : reason,
      link: `/inbox?conversationId=${claimed.conversationId}`,
    })
    return Boolean(created)
  } catch (error) {
    logger.error('Could not notify the agent about a failed reply', {
      messageId,
      error: error instanceof Error ? error.message : error,
    })
    return false
  }
}

/** Clear the marker when the agent retries, so the next final failure notifies again. Never throws. */
export async function clearReplyFailureNotification(messageId: string): Promise<void> {
  try {
    await db
      .update(conversationMessage)
      .set({ metadata: sql`${conversationMessage.metadata} - ${MARKER}::text` })
      .where(and(eq(conversationMessage.id, messageId), sql`${conversationMessage.metadata} ? ${MARKER}::text`))
  } catch (error) {
    logger.warn('Could not clear the reply failure marker', {
      messageId,
      error: error instanceof Error ? error.message : error,
    })
  }
}
