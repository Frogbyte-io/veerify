/**
 * @openapi
 * /api/marketing/r/{token}/withdraw:
 *   post:
 *     tags: [Public]
 *     summary: Withdraw public consent for a testimonial
 *     description: >
 *       Public, token-gated and rate limited per IP and token. Sets public consent to off and
 *       un-features the testimonial submitted with this link, so it disappears from the public wall.
 *       Works for links older than 60 days and when Marketing is switched off. Idempotent.
 *     operationId: withdrawPublicTestimonial
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Consent withdrawn (withdrawn is the number of testimonials changed) }
 *       404: { description: Link not found }
 *       429: { description: Rate limited }
 */
import { withdrawTestimonialConsent } from '~/server/services/marketing/privacy'
import { findReviewRequestByToken, notFound } from '~/server/utils/marketing-reviews'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  await requireRateLimit(event, {
    ...rateLimits.strict,
    identifier: `public-testimonial-withdraw:${token.slice(0, 64)}`,
  })

  const request = await findReviewRequestByToken(token)
  if (!request) notFound('This link is not valid')

  const withdrawn = await withdrawTestimonialConsent(request.id)
  return createSuccessResponse({ withdrawn })
})
