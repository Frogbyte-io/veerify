/**
 * @openapi
 * /api/marketing/r/{token}:
 *   get:
 *     tags: [Public]
 *     summary: Look up a review request link
 *     description: >
 *       Public, token-gated. Returns the product name, the recipient's first name
 *       whether a testimonial was already submitted, whether it was withdrawn from the public page and
 *       whether one can still be submitted. No other personal data.
 *     operationId: getPublicReviewRequest
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Request summary }
 *       404: { description: Link not found }
 *       429: { description: Rate limited }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { testimonial } from '~/server/database/schema/marketing'
import {
  findReviewRequestByToken,
  firstNameOf,
  notFound,
  testimonialSubmissionState,
} from '~/server/utils/marketing-reviews'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.relaxed, identifier: 'public-review-request' })
  const token = getRouterParam(event, 'token') ?? ''

  const request = await findReviewRequestByToken(token)
  if (!request) notFound('This link is not valid')

  const [existing] = await db
    .select({
      id: testimonial.id,
      consentPublic: testimonial.consentPublic,
      createdAt: testimonial.createdAt,
      moderatedAt: testimonial.moderatedAt,
      updatedAt: testimonial.updatedAt,
    })
    .from(testimonial)
    .where(eq(testimonial.reviewRequestId, request.id))
    .limit(1)

  return createSuccessResponse({
    productName: request.projectName,
    firstName: firstNameOf(request.name),
    alreadySubmitted: Boolean(existing),
    // True after the submitter withdrew public consent. There is no explicit withdrawn marker, so this
    // infers it: no public consent, and the row was touched after submission/moderation (withdrawing is
    // the only submitter-side write). A private submission that was never edited stays false.
    withdrawn: Boolean(
      existing &&
      !existing.consentPublic &&
      new Date(existing.updatedAt).getTime() - new Date(existing.moderatedAt ?? existing.createdAt).getTime() > 50
    ),
    // False when the request was not sent, testimonials are off, or the link is older than 60 days.
    canSubmit: testimonialSubmissionState(request) === 'ok',
  })
})
