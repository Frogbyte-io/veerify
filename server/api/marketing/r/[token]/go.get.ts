/**
 * @openapi
 * /api/marketing/r/{token}/go:
 *   get:
 *     tags: [Public]
 *     summary: Tracked redirect to a review platform
 *     description: >
 *       Records the click and redirects (302) to the platform URL configured for the
 *       product. The target is always looked up from the product's saved settings by
 *       platform id; it is never taken from the request, so this is not an open redirect.
 *     operationId: redirectPublicReviewPlatform
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: p
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       302: { description: Redirect to the review platform }
 *       404: { description: Unknown link or platform }
 *       429: { description: Rate limited }
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { reviewRequest } from '~/server/database/schema/marketing'
import { findReviewRequestByToken, notFound } from '~/server/utils/marketing-reviews'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.relaxed, identifier: 'public-review-go' })
  const token = getRouterParam(event, 'token') ?? ''
  const platformId = getQuery(event).p

  const request = await findReviewRequestByToken(token)
  if (!request || typeof platformId !== 'string') notFound('This link is not valid')

  const platform = request.platforms.find((candidate) => candidate.id === platformId)
  // Re-check the scheme: only https URLs configured by the team are ever redirected to.
  if (!platform || !/^https:\/\//i.test(platform.url)) notFound('This link is not valid')

  if (!request.clickedAt) {
    await db
      .update(reviewRequest)
      .set({ clickedAt: new Date() })
      .where(and(eq(reviewRequest.id, request.id), isNull(reviewRequest.clickedAt)))
  }

  return sendRedirect(event, platform.url, 302)
})
