/**
 * @openapi
 * /api/marketing/r/{token}/unsubscribe:
 *   post:
 *     tags: [Public]
 *     summary: Unsubscribe from review requests
 *     description: >
 *       Writes a per-workspace marketing email suppression for the address (by keyed hash when the request was anonymised by retention). Also the
 *       RFC 8058 one-click target (`List-Unsubscribe-Post`). Responds with an HTML page.
 *     operationId: submitPublicReviewUnsubscribe
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Unsubscribed (text/html) }
 *       404: { description: Link not found }
 */
import { db } from '~/server/database/drizzle'
import { writeSuppression } from '~/server/services/marketing/privacy'
import { hashEmail, isRedactedEmail, normalizeMarketingEmail } from '~/server/utils/marketing-email-hash'
import { findReviewRequestByToken, notFound } from '~/server/utils/marketing-reviews'
import { escapeHtmlText, renderNoticePage } from '~/server/utils/marketing-notice-page'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.relaxed, identifier: 'public-review-unsubscribe' })
  const token = getRouterParam(event, 'token') ?? ''
  const request = await findReviewRequestByToken(token)
  if (!request) notFound('This link is not valid')

  // An anonymised request (older than the retention window) only has the keyed hash left.
  const knownEmail = isRedactedEmail(request.email) ? null : normalizeMarketingEmail(request.email)
  const emailHash = request.emailHash ?? (knownEmail ? hashEmail(knownEmail) : null)
  if (emailHash) await writeSuppression(db, { organizationId: request.organizationId, email: knownEmail, emailHash })

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  return renderNoticePage({
    title: 'You are unsubscribed',
    body: `<p>You will not receive more review requests from <strong>${escapeHtmlText(request.projectName)}</strong>.</p>`,
  })
})
