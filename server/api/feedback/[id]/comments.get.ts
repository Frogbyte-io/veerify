import { eq, and, asc } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'

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
      await requirePublicProject(fb.projectId)
    }
  } else {
    await requirePublicProject(fb.projectId)
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
    return {
      ...comment,
      author: comment.authorUserId ? row.authorUser : null,
      canEdit: !!isAuthor,
      isEdited,
    }
  })

  return createSuccessResponse(result)
})
