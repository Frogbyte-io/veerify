import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedbackComment } from '~/server/database/schema/feedback'

const editCommentSchema = z.object({
  body: z.string().min(1, 'Comment body is required').max(5000, 'Comment too long'),
})

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const anonSession = session?.user ? null : await getAnonSession(event)

  const feedbackId = getRouterParam(event, 'id')
  const commentId = getRouterParam(event, 'commentId')

  if (!feedbackId || !commentId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID and comment ID are required'),
    })
  }

  const body = await validateBody(event, editCommentSchema)

  const [comment] = await db.select().from(feedbackComment).where(eq(feedbackComment.id, commentId)).limit(1)

  if (!comment || comment.feedbackId !== feedbackId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Comment not found'),
    })
  }

  // Check authorship
  const isAuthor =
    (session?.user && comment.authorUserId === session.user.id) ||
    (anonSession && comment.authorSessionId === anonSession.id)

  if (!isAuthor) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You can only edit your own comments'),
    })
  }

  const now = new Date()
  const [updated] = await db
    .update(feedbackComment)
    .set({ body: body.body, updatedAt: now })
    .where(eq(feedbackComment.id, commentId))
    .returning()

  return createSuccessResponse(updated)
})
