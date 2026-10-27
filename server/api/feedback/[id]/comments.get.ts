/**
 * @openapi
 * /api/feedback/{id}/comments:
 *   get:
 *     tags: [Feedback]
 *     summary: List comments on a feedback item
 *     description: >
 *       Returns comments oldest first, with author, edited flag and canEdit/canDelete. Internal comments are returned only to project members. Authentication is optional: anonymous callers are accepted subject to public project and product rules. Signed-in callers may use a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listFeedbackComments
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
 *     responses:
 *       200: { description: "Array of comments" }
 *       401: { description: "Invalid personal API key" }
 *       403: { description: "Project is not public and caller has no access" }
 *       404: { description: "Feedback not found" }
 */
import { eq, and, asc } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'
import { requirePublicFeedback } from '~/server/utils/feedback-access'

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const anonSession = session?.user ? null : await getAnonSession(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  // Verify feedback exists
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Verify access to project
  let isTeamMember = false
  if (session?.user) {
    try {
      await requireProjectAccess(fb.projectId, session.user.id)
      isTeamMember = true
    } catch {
      // If user doesn't have team access, check if project is public
      await requirePublicFeedback(fb)
    }
  } else {
    await requirePublicFeedback(fb)
  }

  // Build where clause - hide internal comments from non-team-members
  const conditions = [eq(feedbackComment.feedbackId, id)]
  if (!isTeamMember) {
    conditions.push(eq(feedbackComment.isInternal, false))
  }

  // Fetch comments ordered by creation time
  const comments = await db
    .select({
      comment: feedbackComment,
      authorUser: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(feedbackComment)
    .leftJoin(user, eq(feedbackComment.authorUserId, user.id))
    .where(and(...conditions))
    .orderBy(asc(feedbackComment.createdAt))

  const userId = session?.user?.id || null
  const anonSessionId = anonSession?.id || null

  const result = comments.map((row) => {
    const comment = row.comment
    const isAuthor =
      (userId && comment.authorUserId === userId) || (anonSessionId && comment.authorSessionId === anonSessionId)
    const isEdited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime()
    const canManageComment = Boolean(isAuthor || isTeamMember)
    return {
      ...comment,
      author: comment.authorUserId ? row.authorUser : null,
      canEdit: canManageComment,
      canDelete: canManageComment,
      isEdited,
    }
  })

  return createSuccessResponse(result)
})
