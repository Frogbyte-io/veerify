/**
 * @openapi
 * /api/marketing/r/{token}/testimonial:
 *   post:
 *     tags: [Public]
 *     summary: Submit a testimonial
 *     description: >
 *       Public, token-gated and rate limited per IP and token. One testimonial per
 *       token, only for a sent request whose product still asks for testimonials,
 *       and only within 60 days of sending. The testimonial starts as pending; it is only shown on the public
 *       wall once a team member approves it AND the author ticked the public consent box.
 *     operationId: submitPublicTestimonial
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [authorName, quote, consentPublic]
 *             properties:
 *               authorName: { type: string, maxLength: 80 }
 *               authorTitle: { type: string, maxLength: 80 }
 *               authorCompany: { type: string, maxLength: 80 }
 *               quote: { type: string, minLength: 20, maxLength: 1000 }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               consentPublic: { type: boolean }
 *     responses:
 *       200: { description: Testimonial received }
 *       400: { description: Validation failed }
 *       404: { description: Link not found, request not sent, or testimonials or Marketing switched off }
 *       409: { description: A testimonial was already submitted with this link }
 *       410: { description: The link is older than 60 days }
 *       429: { description: Rate limited }
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { reviewRequest, reviewRequestSettings, testimonial } from '~/server/database/schema/marketing'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { notFound, testimonialSubmissionState } from '~/server/utils/marketing-reviews'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const optionalText = z
  .string()
  .trim()
  .max(80, 'Must be 80 characters or fewer')
  .optional()
  .transform((value) => (value ? value : null))

const bodySchema = z.object({
  authorName: z.string().trim().min(1, 'Your name is required').max(80, 'Name must be 80 characters or fewer'),
  authorTitle: optionalText,
  authorCompany: optionalText,
  quote: z
    .string()
    .trim()
    .min(20, 'Please write at least 20 characters')
    .max(1000, 'Please keep it under 1000 characters'),
  rating: z.number().int().min(1).max(5).optional(),
  consentPublic: z.boolean(),
})

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  // The limiter key is `<identifier>:<client ip>`, so including the token makes it per IP and token.
  await requireRateLimit(event, { ...rateLimits.strict, identifier: `public-testimonial:${token.slice(0, 64)}` })
  const body = await validateBody(event, bodySchema)

  const outcome = await db.transaction(async (tx) => {
    // Locking the request row serializes concurrent submissions for one token.
    const [request] = await tx
      .select({
        id: reviewRequest.id,
        projectId: reviewRequest.projectId,
        email: reviewRequest.email,
        status: reviewRequest.status,
        sentAt: reviewRequest.sentAt,
        createdAt: reviewRequest.createdAt,
        projectSettings: project.settings,
        teamMarketingEnabled: teamModuleSettings.marketingEnabled,
        requestsEnabled: reviewRequestSettings.enabled,
        askForTestimonial: reviewRequestSettings.askForTestimonial,
      })
      .from(reviewRequest)
      .innerJoin(project, eq(project.id, reviewRequest.projectId))
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, reviewRequest.teamId))
      .leftJoin(reviewRequestSettings, eq(reviewRequestSettings.projectId, reviewRequest.projectId))
      .where(eq(reviewRequest.token, token))
      .limit(1)
      .for('update', { of: reviewRequest })
    if (!request) return 'not_found' as const

    const state = testimonialSubmissionState(request)
    if (state === 'unavailable') return 'not_found' as const
    if (state === 'expired') return 'expired' as const

    const [existing] = await tx
      .select({ id: testimonial.id })
      .from(testimonial)
      .where(eq(testimonial.reviewRequestId, request.id))
      .limit(1)
    if (existing) return 'duplicate' as const

    await tx.insert(testimonial).values({
      id: randomUUID(),
      projectId: request.projectId,
      reviewRequestId: request.id,
      authorName: body.authorName,
      authorTitle: body.authorTitle,
      authorCompany: body.authorCompany,
      authorEmail: request.email,
      quote: body.quote,
      rating: body.rating ?? null,
      consentPublic: body.consentPublic,
      status: 'pending',
    })
    return 'created' as const
  })

  if (outcome === 'not_found') notFound('This link is not valid')
  if (outcome === 'expired') {
    throw createError({
      statusCode: 410,
      statusMessage: 'Gone',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'This link has expired'),
    })
  }
  if (outcome === 'duplicate') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'A testimonial was already submitted with this link'),
    })
  }

  return createSuccessResponse({ received: true })
})
