/**
 * @openapi
 * /api/marketing/r/{token}/unsubscribe:
 *   get:
 *     tags: [Public]
 *     summary: Unsubscribe confirmation page
 *     description: >
 *       Shows an HTML confirmation page with a button that POSTs to this URL.
 *       Nothing is changed by GET, so mail scanners that prefetch links cannot unsubscribe anyone.
 *     operationId: getPublicReviewUnsubscribePage
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Confirmation page (text/html) }
 *       404: { description: Link not found }
 */
import { findReviewRequestByToken, notFound } from '~/server/utils/marketing-reviews'
import { escapeHtmlText, renderNoticePage } from '~/server/utils/marketing-notice-page'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.relaxed, identifier: 'public-review-unsubscribe' })
  const token = getRouterParam(event, 'token') ?? ''
  const request = await findReviewRequestByToken(token)
  if (!request) notFound('This link is not valid')

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  return renderNoticePage({
    title: 'Unsubscribe',
    body: `<p>Stop receiving review and testimonial requests from <strong>${escapeHtmlText(request.projectName)}</strong>?</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`,
  })
})
