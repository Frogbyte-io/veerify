import { eq, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import { requireProjectAccess } from '~/server/utils/project-access'

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

  const [comment] = await db.select().from(feedbackComment).where(eq(feedbackComment.id, commentId)).limit(1)

  if (!comment || comment.feedbackId !== feedbackId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Comment not found'),
    })
  }

  const [fb] = await db.select({ projectId: feedback.projectId }).from(feedback).where(eq(feedback.id, feedbackId)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  const isAuthor =
    (session?.user && comment.authorUserId === session.user.id) ||
    (anonSession && comment.authorSessionId === anonSession.id)

  let isTeamMember = false
  if (session?.user) {
    try {
      await requireProjectAccess(fb.projectId, session.user.id)
      isTeamMember = true
    } catch {
      isTeamMember = false
    }
  }

  if (!isAuthor && !isTeamMember) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have permission to delete this comment'),
    })
  }

  await db.delete(feedbackComment).where(eq(feedbackComment.id, commentId))

  // Decrement comment count on the feedback item
  await db
    .update(feedback)
    .set({ commentCount: sql`GREATEST(${feedback.commentCount} - 1, 0)`, updatedAt: new Date() })
    .where(eq(feedback.id, feedbackId))

  return createSuccessResponse({ deleted: true })
})
