/**
 * @openapi
 * /api/public/csat/{token}:
 *   get:
 *     tags: [Public]
 *     summary: Read a public CSAT survey response state
 *     operationId: getPublicCsatResponse
 *     responses:
 *       200: { description: CSAT response state }
 *       404: { description: CSAT response not found }
 */
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { getCsatResponse, CSAT_COMMENT_WINDOW_MINUTES } from '~/server/utils/csat'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'CSAT token is required'),
    })
  }
  const row = await getCsatResponse(token)
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'CSAT response not found'),
    })
  }

  const commentWindowEndsAt = row.response.respondedAt
    ? new Date(row.response.respondedAt.getTime() + CSAT_COMMENT_WINDOW_MINUTES * 60_000)
    : null
  const now = Date.now()
  const status = !row.response.respondedAt
    ? 'pending_rating'
    : row.response.comment !== null
      ? 'complete'
      : commentWindowEndsAt && commentWindowEndsAt.getTime() >= now
        ? 'comment_open'
        : 'complete'

  return createSuccessResponse({
    survey: {
      scale: row.response.scale,
      question: row.survey.question,
      followUpQuestion: row.survey.followUpQuestion,
    },
    response: {
      status,
      rating: row.response.rating,
      comment: row.response.comment,
      respondedAt: row.response.respondedAt,
      commentWindowEndsAt,
    },
  })
})
