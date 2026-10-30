/**
 * @openapi
 * /api/support/frogmail/events:
 *   post:
 *     tags: [Support]
 *     summary: Frogmail webhook (forward destination lifecycle)
 *     description: >
 *       Native Frogmail webhooks, verified with `FROGMAIL_WEBHOOK_SECRET`
 *       (`Frogmail-Signature` or `Larasend-Signature`: `t=<unix>,v1=<hex>`, HMAC-SHA256 of
 *       `<t>.<raw body>`, 300 second window, replays rejected). Handles
 *       `forward_destination.verified`, `.revoked` and `.suspended`; anything else is acknowledged
 *       and ignored. Subscribe with `POST /api/v1/webhook-endpoints` on the Frogmail side.
 *     operationId: receiveFrogmailEvent
 *     security: []
 *     responses:
 *       200: { description: Accepted, or deliberately ignored }
 *       401: { description: Signature missing, invalid, stale or replayed }
 *       404: { description: Webhook secret not configured }
 *       429: { description: Rate limited }
 */
import { createError, defineEventHandler, getHeaders, readRawBody } from 'h3'
import { applyForwardDestinationEvent } from '~/server/utils/frogmail-destination-events'
import { parseWebhookSecrets, verifyFrogmailWebhook } from '~/server/utils/frogmail-webhook'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'

const logger = createLogger('frogmail-webhook')
const RATE_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'frogmail-webhook' }

export default defineEventHandler(async (event) => {
  const secrets = parseWebhookSecrets(process.env.FROGMAIL_WEBHOOK_SECRET)
  // Unconfigured: the endpoint does not exist (self-hosted without Frogmail).
  if (secrets.length === 0) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  if (!(await checkRateLimit(event, RATE_LIMIT))) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const verdict = await verifyFrogmailWebhook({
    rawBody,
    headers: getHeaders(event) as Record<string, string | undefined>,
    secrets,
  })
  if (!verdict.ok) {
    logger.warn('Rejected Frogmail webhook', { reason: verdict.reason })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return createSuccessResponse({ accepted: true, reason: 'unparseable-payload' })
  }

  try {
    const applied = await applyForwardDestinationEvent(payload)
    return createSuccessResponse({ accepted: true, reason: applied ? 'processed' : 'ignored' })
  } catch (error) {
    logger.error('Frogmail webhook processing failed', { error: error instanceof Error ? error.message : error })
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})
