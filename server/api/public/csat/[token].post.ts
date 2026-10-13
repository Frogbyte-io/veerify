/**
 * @openapi
 * /api/public/csat/{token}:
 *   post:
 *     tags: [Public]
 *     summary: Submit a public CSAT rating or follow-up comment
 *     operationId: submitPublicCsatResponse
 *     responses:
 *       200: { description: CSAT response recorded }
 *       400: { description: Invalid rating or request }
 *       404: { description: CSAT response not found }
 *       409: { description: Rating already submitted or comment window closed }
 */
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { CsatResponseError, submitCsatResponse } from '~/server/utils/csat'

const bodySchema = z
  .object({
    rating: z.number().int().min(0).max(10).optional(),
    comment: z.string().trim().max(2_000).optional(),
  })
  .refine((value) => value.rating !== undefined || Boolean(value.comment), {
    message: 'A rating or follow-up comment is required',
  })

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.strict, identifier: 'public-csat' })
  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'CSAT token is required'),
    })
  }
  const body = await validateBody(event, bodySchema)

  try {
    const result = await submitCsatResponse({ token, rating: body.rating, comment: body.comment })
    return createSuccessResponse({
      response: {
        rating: result.response.rating,
        comment: result.response.comment,
        respondedAt: result.response.respondedAt,
      },
    })
  } catch (error) {
    if (!(error instanceof CsatResponseError)) throw error
    const statusCode = error.code === 'not_found' ? 404 : error.code === 'invalid_rating' ? 400 : 409
    const errorCode =
      error.code === 'not_found'
        ? ErrorCode.NOT_FOUND
        : error.code === 'invalid_rating'
          ? ErrorCode.VALIDATION_ERROR
          : ErrorCode.CONFLICT
    throw createError({
      statusCode,
      statusMessage: statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Bad Request' : 'Conflict',
      data: createErrorResponse(errorCode, error.message),
    })
  }
})
