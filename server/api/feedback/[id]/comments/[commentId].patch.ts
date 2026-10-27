/**
 * @openapi
 * /api/feedback/{id}/comments/{commentId}:
 *   patch:
 *     tags: [Feedback]
 *     summary: Edit a comment
 *     description: >
 *       Edits the comment body. Allowed for the comment author (signed in, or the same anonymous session) or any project member. Authentication is optional: anonymous callers are accepted subject to public project and product rules. Signed-in callers may use a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateFeedbackComment
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Feedback id
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         description: Comment id
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, minLength: 1, maxLength: 5000 }
 *     responses:
 *       200: { description: "Updated comment" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Invalid personal API key" }
 *       403: { description: "Not the author and not a project member" }
 *       404: { description: "Comment or feedback not found" }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import { requireProjectAccess } from '~/server/utils/project-access'

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

  const [fb] = await db
    .select({ projectId: feedback.projectId })
    .from(feedback)
    .where(eq(feedback.id, feedbackId))
    .limit(1)
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
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have permission to edit this comment'),
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
