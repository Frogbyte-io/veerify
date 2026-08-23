/**
 * @openapi
 * /api/support/conversations/{id}/messages/{messageId}/retry:
 *   post:
 *     tags: [Support]
 *     summary: Retry a failed outgoing reply
 *     description: >
 *       Only a message whose `deliveryStatus` is `failed` can be retried - an
 *       agent-initiated retry is a deliberate decision to try again from
 *       scratch (`resetOutboundDeliveryForRetry`), not one more of the outbox
 *       worker's own automatic attempts. Triggers a worker pass immediately
 *       rather than waiting for the next unrelated reply to piggyback on.
 *     operationId: retrySupportConversationMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Retry queued }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation, message, or its outbox row not found }
 *       409: { description: The message is not in a failed delivery state }
 */
import { and, eq } from 'drizzle-orm'
import { createConsola } from 'consola'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { conversationMessage, supportOutboundDelivery } from '~/server/database/schema/support'
import { resetOutboundDeliveryForRetry, runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'

const logger = createConsola().withTag('veerify').withTag('support-outbound')

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const messageId = getRouterParam(event, 'messageId') as string

  await requireConversationAccess(conversationId, session.user.id)

  const [message] = await db
    .select()
    .from(conversationMessage)
    .where(and(eq(conversationMessage.id, messageId), eq(conversationMessage.conversationId, conversationId)))
    .limit(1)

  if (!message) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Message not found'),
    })
  }

  // Notes never dispatch (SUP-04-5) and never carry a delivery outcome to
  // retry; only an outgoing reply that actually failed to send is retryable.
  if (message.kind !== 'outgoing' || message.deliveryStatus !== 'failed') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This message is not in a failed delivery state'),
    })
  }

  const [delivery] = await db
    .select({ id: supportOutboundDelivery.id })
    .from(supportOutboundDelivery)
    .where(and(eq(supportOutboundDelivery.messageId, messageId), eq(supportOutboundDelivery.kind, 'email')))
    .limit(1)

  if (!delivery) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No outbox entry found for this message'),
    })
  }

  await resetOutboundDeliveryForRetry(delivery.id, messageId)

  // Fire-and-forget, same pattern as the initial send (SUP-04-4): the
  // response must not wait on SMTP, and the outbox row is the durable copy
  // if this invocation dies before the worker finishes.
  runOutboundDeliveryWorker().catch((error) => {
    logger.error('Outbound delivery worker pass failed after retry', {
      error: error instanceof Error ? error.message : error,
    })
  })

  return createSuccessResponse({ retried: true })
})
