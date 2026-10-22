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
 *       The sender is checked first: when the From stored on the delivery is
 *       still not authorized for the team, the retry is refused with 409
 *       `SENDER_NOT_VERIFIED` and nothing is reset. Deliveries that are not
 *       replies (`kind: csat` surveys) have no retry; the thread API marks
 *       them `retryable: false` and this endpoint answers 404.
 *       `previousSubmissionAttempted` is false when the previous failure was
 *       the sender block (`SENDER_DOMAIN_NOT_AUTHORIZED`): nothing was ever
 *       submitted to the provider, so there is no duplicate risk.
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
 *       409: { description: "The message is not in a failed delivery state, or its sender is still not verified (SENDER_NOT_VERIFIED)" }
 */
import { and, eq } from 'drizzle-orm'
import { createConsola } from 'consola'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { conversationMessage, supportOutboundDelivery } from '~/server/database/schema/support'
import {
  resetOutboundDeliveryForRetry,
  runOutboundDeliveryWorker,
  SENDER_DOMAIN_NOT_AUTHORIZED,
} from '~/server/utils/outbound-delivery'
import { isSenderAllowedForTeam } from '~/server/utils/sender-enforcement'
import { emailDomain } from '~/server/services/support-channels/types'

const logger = createConsola().withTag('veerify').withTag('support-outbound')

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const messageId = getRouterParam(event, 'messageId') as string

  const access = await requireConversationAccess(conversationId, session.user.id)

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
    .select({
      id: supportOutboundDelivery.id,
      attemptCount: supportOutboundDelivery.attemptCount,
      lastError: supportOutboundDelivery.lastError,
      payload: supportOutboundDelivery.payload,
    })
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

  // Refuse before resetting: a retry that the worker would immediately block
  // again only burns the agent's click and rewrites the failure.
  const from = delivery.payload.from?.address
  if (from && !(await isSenderAllowedForTeam(access.teamId, from))) {
    const senderDomain = emailDomain(from) ?? from
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        'SENDER_NOT_VERIFIED',
        `Replies from ${from} are blocked until ${senderDomain} is verified in Support settings`
      ),
    })
  }

  const previousSubmissionAttempted = delivery.attemptCount > 0 && delivery.lastError !== SENDER_DOMAIN_NOT_AUTHORIZED
  const reset = await resetOutboundDeliveryForRetry(delivery.id, messageId)
  if (!reset) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This delivery was already retried'),
    })
  }

  // Fire-and-forget, same pattern as the initial send (SUP-04-4): the
  // response must not wait on SMTP, and the outbox row is the durable copy
  // if this invocation dies before the worker finishes.
  runOutboundDeliveryWorker().catch((error) => {
    logger.error('Outbound delivery worker pass failed after retry', {
      error: error instanceof Error ? error.message : error,
    })
  })

  return createSuccessResponse({ retried: true, previousSubmissionAttempted })
})
