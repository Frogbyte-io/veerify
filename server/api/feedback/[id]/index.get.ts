import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const anonSession = !session?.user ? await getAnonSession(event) : null

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  // Get feedback with category
  const [item] = await db
    .select({
      feedback: feedback,
      category: feedbackCategory,
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(eq(feedback.id, id))
    .limit(1)

  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Verify access to project
  if (session?.user) {
    await requireProjectAccess(item.feedback.projectId, session.user.id)
  } else {
    await requirePublicProject(item.feedback.projectId)
  }

  // Check if viewer has voted
  let hasVoted = false
  if (session?.user) {
    const [userVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterUserId, session.user.id)))
      .limit(1)
    hasVoted = !!userVote
  } else if (anonSession) {
    const [sessionVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterSessionId, anonSession.id)))
      .limit(1)
    hasVoted = !!sessionVote
  }

  const isOwn = session?.user
    ? item.feedback.authorUserId === session.user.id
    : anonSession
      ? item.feedback.authorSessionId === anonSession.id
      : false

  return createSuccessResponse({
    ...item.feedback,
    category: item.category,
    hasVoted,
    isOwn,
  })
})
