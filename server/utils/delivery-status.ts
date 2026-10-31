import { and, eq, inArray, ne } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { conversationMessage } from '~/server/database/schema/support'
import { recordSupportMetric } from '~/server/utils/support-observability'

/**
 * `delayed`: the provider accepted the reply but the recipient's server
 * deferred it (a temporary failure); the provider keeps retrying. Not
 * terminal: `delivered` or `bounced` still follow.
 */
export type DeliveryStatus = 'pending' | 'sent' | 'delayed' | 'delivered' | 'failed' | 'bounced'
type DeliveryStatusExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Promote any non-terminal message status to delivered in one guarded update. */
export async function markDeliveryMessageDelivered(
  executor: DeliveryStatusExecutor,
  messageId: string
): Promise<boolean> {
  const [updated] = await executor
    .update(conversationMessage)
    .set({ deliveryStatus: 'delivered', deliveryError: null })
    .where(
      and(
        eq(conversationMessage.id, messageId),
        ne(conversationMessage.deliveryStatus, 'bounced'),
        ne(conversationMessage.deliveryStatus, 'delivered')
      )
    )
    .returning({ id: conversationMessage.id })

  // Counted here rather than at the webhook route so the metric fires exactly
  // when the status actually moved. The guarded update is what decides that:
  // a redelivered or out-of-order provider event reaches the route again but
  // updates nothing, and must not be counted twice.
  if (updated) recordSupportMetric('support.delivery.delivered', { messageId })

  return Boolean(updated)
}

/** Record a hard bounce unless another event has already made it terminal. */
export async function markDeliveryMessageBounced(
  executor: DeliveryStatusExecutor,
  messageId: string,
  error: string | null
): Promise<boolean> {
  const [updated] = await executor
    .update(conversationMessage)
    .set({ deliveryStatus: 'bounced', deliveryError: error })
    .where(and(eq(conversationMessage.id, messageId), ne(conversationMessage.deliveryStatus, 'bounced')))
    .returning({ id: conversationMessage.id })

  // The stored `error` is deliberately not a metric field: it is provider text
  // and can carry the recipient address. Only the fact of the bounce is counted.
  if (updated) recordSupportMetric('support.delivery.bounced', { messageId })

  return Boolean(updated)
}

/**
 * Record a temporary failure (`temporary_fail`, soft bounce): the provider is
 * still retrying. Only moves `sent` (or refreshes `delayed`) so it never
 * regresses a final state (`delivered`, `bounced`, `failed`) or a message the
 * outbox has not handed over yet (`pending`), whatever order events arrive in.
 */
export async function markDeliveryMessageDelayed(
  executor: DeliveryStatusExecutor,
  messageId: string,
  error: string | null
): Promise<boolean> {
  const [updated] = await executor
    .update(conversationMessage)
    .set({ deliveryStatus: 'delayed', deliveryError: error })
    .where(and(eq(conversationMessage.id, messageId), inArray(conversationMessage.deliveryStatus, ['sent', 'delayed'])))
    .returning({ id: conversationMessage.id })

  if (updated) recordSupportMetric('support.delivery.delayed', { messageId })

  return Boolean(updated)
}
