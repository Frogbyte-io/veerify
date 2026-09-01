/**
 * @openapi
 * /api/support/delivery/{provider}:
 *   post:
 *     tags: [Support]
 *     summary: Delivery, bounce, and engagement webhook
 *     description: >
 *       Provider-agnostic. Returns 200 for everything it deliberately did not
 *       act on - a duplicate event, one that cannot be correlated to a
 *       message this app sent, or an engagement event (open/click/complaint)
 *       Stage 04 only records - because a 4xx makes a provider retry
 *       indefinitely. Processing failures return a retryable 500. Only a
 *       failed signature is a 401.
 *     operationId: receiveSupportDeliveryEvent
 *     security: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [postmark, mailgun] }
 *     responses:
 *       200: { description: Accepted, or deliberately ignored }
 *       401: { description: Signature verification failed }
 *       404: { description: Unknown provider }
 *       429: { description: Rate limited }
 *       500: { description: Processing failed; provider should retry }
 */
import { getHeaders, getRouterParam, readRawBody } from 'h3'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'
import { getChannelDriver } from '~/server/services/support-channels'
import {
  applyDeliveryEventStatus,
  claimDeliveryEvent,
  completeDeliveryEvent,
  failDeliveryEvent,
} from '~/server/utils/delivery-events'
import { publishDeliveryStatusChanged, resolveDeliveryCorrelation } from '~/server/utils/outbound-delivery'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'

const logger = createLogger('support-delivery')

/** Delivery is webhook traffic like inbound, not user traffic - a high-volume sender is legitimate. */
const DELIVERY_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'support-delivery' }

/** Accepted, deliberately did nothing (or nothing more than recording the event). The provider must not retry. */
function accepted(reason: string) {
  return createSuccessResponse({ accepted: true, reason })
}

export default defineEventHandler(async (event) => {
  const providerName = getRouterParam(event, 'provider') as string

  const driver = getChannelDriver(providerName)
  if (!driver) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown delivery provider' })
  }

  if (!(await checkRateLimit(event, DELIVERY_RATE_LIMIT))) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const headers = getHeaders(event) as Record<string, string>

  // ---- 1. Signature -------------------------------------------------------
  // Same verifySignature as inbound: both providers protect every webhook URL
  // on an account identically (Postmark: Basic Auth in the URL; Mailgun: the
  // HMAC envelope), so there is nothing delivery-specific to check here.
  if (!driver.verifySignature({ rawBody, headers, authorization: headers.authorization })) {
    logger.warn('Rejected delivery event with an invalid signature', { provider: driver.name })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    logger.error('Delivery payload was signature-valid but not JSON', { provider: driver.name })
    return accepted('unparseable-payload')
  }

  // ---- 2. Parse -------------------------------------------------------------
  // Ahead of the claim, unlike inbound: parsing here is pure and in-memory
  // (no raw-body archival, no side effects), so there is no crash window to
  // protect against by claiming first. This is also what lets `recordType`/
  // `recipient` - real NOT NULL columns - be known at claim time. See
  // delivery-events.ts's module doc.
  let deliveryEvent: ReturnType<(typeof driver)['parseDeliveryEvent']>
  try {
    deliveryEvent = driver.parseDeliveryEvent(payload)
  } catch (error) {
    logger.error('Delivery payload was signature-valid but unparseable', {
      provider: driver.name,
      error: error instanceof Error ? error.message : error,
    })
    return accepted('unparseable-event')
  }

  if (!deliveryEvent.providerEventId) {
    logger.error('Delivery payload carried no usable event id', { provider: driver.name })
    return accepted('missing-event-id')
  }

  // Resolve only through durable outbox metadata. A signature-valid event may
  // legitimately resolve to nothing and is still recorded and acknowledged.
  const resolvedMessage = await resolveDeliveryCorrelation({
    provider: driver.name,
    providerAccountKey: deliveryEvent.providerAccountKey,
    correlationKey: deliveryEvent.correlationKey,
    providerMessageId: deliveryEvent.providerMessageId,
    recipient: deliveryEvent.recipient,
  })

  // ---- 3. Atomic claim ------------------------------------------------------
  const claim = await claimDeliveryEvent({
    provider: driver.name,
    providerAccountKey: deliveryEvent.providerAccountKey,
    providerEventId: deliveryEvent.providerEventId,
    correlationKey: deliveryEvent.correlationKey,
    recordType: deliveryEvent.recordType,
    recipient: deliveryEvent.recipient ?? 'unknown',
    messageId: resolvedMessage?.id ?? null,
    occurredAt: deliveryEvent.occurredAt,
  })

  if (claim.outcome === 'duplicate') return accepted('duplicate-event')
  if (claim.outcome === 'in-progress') return accepted('already-processing')

  const { eventId, attemptCount } = claim

  try {
    if (!resolvedMessage) {
      // Recorded, not dropped: this is how a broken correlation assumption
      // becomes visible instead of silently doing nothing forever.
      logger.warn('Delivery event could not be correlated to a sent message', {
        provider: driver.name,
        recordType: deliveryEvent.recordType,
        providerAccountKey: deliveryEvent.providerAccountKey,
        providerMessageId: deliveryEvent.providerMessageId,
        correlationKey: deliveryEvent.correlationKey,
      })
      await db.transaction((tx) => completeDeliveryEvent(eventId, attemptCount, tx))
      return accepted('unmatched-message')
    }

    // ---- 4. Map onto conversationMessage.deliveryStatus --------------------
    let statusChanged = false
    if (deliveryEvent.recordType === 'delivered') {
      await db.transaction(async (tx) => {
        statusChanged = await applyDeliveryEventStatus(tx, {
          ...deliveryEvent,
          messageId: resolvedMessage.id,
          conversationId: resolvedMessage.conversationId,
        })
        await completeDeliveryEvent(eventId, attemptCount, tx)
      })
    } else if (deliveryEvent.recordType === 'bounced') {
      // Only a HARD bounce is a delivery failure worth showing as one. A soft
      // bounce is the provider's own SMTP retry still in flight - the message
      // already left our outbox successfully, and `deliveryStatus` would
      // mislead an agent into thinking it needs a resend it does not need.
      if (deliveryEvent.bounceType === 'hard') {
        // One transaction: the status flip and the activity line that
        // explains it must never observably disagree.
        await db.transaction(async (tx) => {
          statusChanged = await applyDeliveryEventStatus(tx, {
            ...deliveryEvent,
            messageId: resolvedMessage.id,
            conversationId: resolvedMessage.conversationId,
          })
          await completeDeliveryEvent(eventId, attemptCount, tx)
        })
      }
      // A soft bounce is still recorded via completeDeliveryEvent below, just
      // with no status change and no activity line.
    }
    // 'opened' | 'clicked' | 'spam_complaint': recorded for audit/future
    // stages, no deliveryStatus change - out of this stage's acceptance
    // criteria.

    if (
      deliveryEvent.recordType !== 'delivered' &&
      !(deliveryEvent.recordType === 'bounced' && deliveryEvent.bounceType === 'hard')
    ) {
      await db.transaction((tx) => completeDeliveryEvent(eventId, attemptCount, tx))
    }
    if (statusChanged) await publishDeliveryStatusChanged(resolvedMessage.id)
    return accepted('processed')
  } catch (error) {
    const recorded = await failDeliveryEvent(eventId, attemptCount, error)
    if (!recorded) logger.warn('Delivery event ownership was lost before failure recording', { eventId })
    logger.error('Delivery event processing failed', {
      eventId,
      provider: driver.name,
      error: error instanceof Error ? error.message : error,
    })
    throw createError({ statusCode: 500, statusMessage: 'Delivery event processing failed' })
  }
})
