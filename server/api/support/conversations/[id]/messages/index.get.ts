/**
 * @openapi
 * /api/support/conversations/{id}/messages:
 *   get:
 *     tags: [Support]
 *     summary: Get a conversation's message thread
 *     description: >
 *       Returns the most recent window of messages in ascending (oldest-first)
 *       order, ready to render as a chat thread. `hasMore: true` means older
 *       history exists above the returned window - this endpoint always
 *       anchors to the newest messages, never to an arbitrary page. All
 *       kinds (`incoming`, `outgoing`, `note`, `activity`) are included,
 *       private notes too, since this is the agent-facing thread pane.
 *       Outgoing messages carry delivery detail for the retry UI:
 *       `deliveryError` (short sanitized text or null), `senderBlocked`
 *       (true when the failure is `SENDER_DOMAIN_NOT_AUTHORIZED`: the message
 *       was never submitted to the provider) and `retryable` (true only for a
 *       failed reply that has an email outbox entry; CSAT survey deliveries are
 *       never retryable). `deliveryStatus` is pending, sent, delayed (the
 *       recipient's server deferred it and the provider is retrying),
 *       delivered, failed or bounced. `failureReason` classifies a failed,
 *       bounced or delayed reply's `deliveryError` (sender_rejected,
 *       recipient_rejected, mailbox_full, provider_unavailable, configuration,
 *       abandoned, unknown; null otherwise). `deliveryAttempt` is set while the
 *       outbox retries a pending reply after a failed attempt:
 *       `{ current, max, nextAttemptAt }` (null otherwise).
 *     operationId: listSupportConversationMessages
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
 *     responses:
 *       200: { description: Message thread, oldest first }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversationAttachment, conversationMessage, supportOutboundDelivery } from '~/server/database/schema/support'
import { MAX_DELIVERY_ATTEMPTS, SENDER_DOMAIN_NOT_AUTHORIZED } from '~/server/utils/outbound-delivery'
import { classifyDeliveryError } from '~/lib/support-delivery-errors'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const query = validateQuery(event, querySchema)

  await requireConversationAccess(conversationId, session.user.id)

  // Fetch the newest window in descending order, then reverse it into the
  // ascending order the thread pane renders - a plain ascending scan with
  // OFFSET would have to walk the entire history to find the tail.
  const rows = await db
    .select({
      id: conversationMessage.id,
      conversationId: conversationMessage.conversationId,
      kind: conversationMessage.kind,
      body: conversationMessage.body,
      bodyHtml: conversationMessage.bodyHtml,
      senderKind: conversationMessage.senderKind,
      senderContactId: conversationMessage.senderContactId,
      senderUserId: conversationMessage.senderUserId,
      isPrivate: conversationMessage.isPrivate,
      channelMessageId: conversationMessage.channelMessageId,
      inReplyTo: conversationMessage.inReplyTo,
      deliveryStatus: conversationMessage.deliveryStatus,
      deliveryError: conversationMessage.deliveryError,
      metadata: conversationMessage.metadata,
      createdAt: conversationMessage.createdAt,
    })
    .from(conversationMessage)
    .where(eq(conversationMessage.conversationId, conversationId))
    .orderBy(desc(conversationMessage.createdAt), desc(conversationMessage.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = (hasMore ? rows.slice(0, query.limit) : rows).reverse()
  const messageIds = items.map((item) => item.id)
  const attachments = messageIds.length
    ? await db
        .select({
          id: conversationAttachment.id,
          messageId: conversationAttachment.messageId,
          fileName: conversationAttachment.fileName,
          contentType: conversationAttachment.contentType,
          sizeBytes: conversationAttachment.sizeBytes,
          createdAt: conversationAttachment.createdAt,
        })
        .from(conversationAttachment)
        .where(inArray(conversationAttachment.messageId, messageIds))
        .orderBy(asc(conversationAttachment.createdAt), asc(conversationAttachment.id))
    : []
  const attachmentsByMessage = new Map<string, typeof attachments>()
  for (const attachment of attachments) {
    const list = attachmentsByMessage.get(attachment.messageId) ?? []
    list.push(attachment)
    attachmentsByMessage.set(attachment.messageId, list)
  }
  const emailDeliveries = messageIds.length
    ? await db
        .select({
          messageId: supportOutboundDelivery.messageId,
          status: supportOutboundDelivery.status,
          attemptCount: supportOutboundDelivery.attemptCount,
          leaseExpiresAt: supportOutboundDelivery.leaseExpiresAt,
          nextAttemptAt: supportOutboundDelivery.nextAttemptAt,
        })
        .from(supportOutboundDelivery)
        .where(and(inArray(supportOutboundDelivery.messageId, messageIds), eq(supportOutboundDelivery.kind, 'email')))
    : []
  const hasEmailDelivery = new Set(emailDeliveries.map((delivery) => delivery.messageId))
  const deliveryByMessage = new Map(emailDeliveries.map((delivery) => [delivery.messageId, delivery]))
  const now = Date.now()
  /** "Attempt n of 5" for a pending reply the outbox is retrying; null on the first attempt. */
  const attemptOf = (messageId: string, deliveryStatus: string) => {
    const delivery = deliveryByMessage.get(messageId)
    if (deliveryStatus !== 'pending' || delivery?.status !== 'pending' || delivery.attemptCount < 1) return null
    const inFlight = delivery.leaseExpiresAt !== null && new Date(delivery.leaseExpiresAt).getTime() > now
    // Below the cap a failed attempt leaves the row pending with no lease until the next one.
    if (!inFlight && delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS) return null
    if (inFlight && delivery.attemptCount === 1) return null
    return {
      current: inFlight ? delivery.attemptCount : delivery.attemptCount + 1,
      max: MAX_DELIVERY_ATTEMPTS,
      nextAttemptAt: !inFlight && delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt).toISOString() : null,
    }
  }
  const enrichedItems = items.map(({ metadata, ...item }) => ({
    ...item,
    // Only the mail-forwarding notes; the message metadata itself stays internal.
    mailNotes: {
      ...(Array.isArray(metadata?.frogmailForwards) ? { frogmailForwards: metadata.frogmailForwards } : {}),
      ...(metadata?.attachmentsRemoved === true ? { attachmentsRemoved: true } : {}),
    },
    senderBlocked: item.deliveryStatus === 'failed' && item.deliveryError === SENDER_DOMAIN_NOT_AUTHORIZED,
    failureReason:
      item.kind === 'outgoing' && ['failed', 'bounced', 'delayed'].includes(item.deliveryStatus)
        ? classifyDeliveryError(item.deliveryError)
        : null,
    deliveryAttempt: item.kind === 'outgoing' ? attemptOf(item.id, item.deliveryStatus) : null,
    retryable: item.kind === 'outgoing' && item.deliveryStatus === 'failed' && hasEmailDelivery.has(item.id),
    attachments: (attachmentsByMessage.get(item.id) ?? []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `/api/support/attachments/${encodeURIComponent(attachment.id)}`,
    })),
  }))

  return createSuccessResponse({
    messages: enrichedItems,
    hasMore,
  })
})
