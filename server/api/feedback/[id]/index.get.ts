import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote, project, feedbackSubscription } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'

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

  const isOwn = session?.user
    ? item.feedback.authorUserId === session.user.id
    : anonSession
      ? item.feedback.authorSessionId === anonSession.id
      : false

  // Verify access to project and capture whether the viewer is a team member.
  let isTeamMember = false
  if (session?.user) {
    try {
      await requireProjectAccess(item.feedback.projectId, session.user.id)
      isTeamMember = true
    } catch {
      if (!isOwn) {
        await requirePublicProject(item.feedback.projectId)
      }
    }
  } else {
    await requirePublicProject(item.feedback.projectId)
  }

  // Get author info if feedback was created by a registered user
  let author = null
  if (item.feedback.authorUserId) {
    const [authorUser] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(user)
      .where(eq(user.id, item.feedback.authorUserId))
      .limit(1)
    author = authorUser || null
  }

  // Get project info
  const [proj] = await db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      isPublic: project.isPublic,
    })
    .from(project)
    .where(eq(project.id, item.feedback.projectId))
    .limit(1)

  // Check if viewer has voted and which direction
  let voteType: 'upvote' | 'downvote' | null = null
  if (session?.user) {
    const [userVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterUserId, session.user.id)))
      .limit(1)
    voteType = (userVote?.type as 'upvote' | 'downvote') || null
  } else if (anonSession) {
    const [sessionVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterSessionId, anonSession.id)))
      .limit(1)
    voteType = (sessionVote?.type as 'upvote' | 'downvote') || null
  }

  // Check subscription status for logged-in users
  let isSubscribed = false
  if (session?.user) {
    const [sub] = await db
      .select({ id: feedbackSubscription.id })
      .from(feedbackSubscription)
      .where(and(eq(feedbackSubscription.feedbackId, id), eq(feedbackSubscription.email, session.user.email)))
      .limit(1)
    isSubscribed = Boolean(sub)
  }

  return createSuccessResponse({
    ...item.feedback,
    category: item.category,
    author,
    project: proj,
    tag: item.feedback.metadata?.feedbackType || null,
    hasVoted: voteType !== null,
    voteType,
    isOwn,
    isSubscribed,
    canEdit: isOwn || isTeamMember,
    canDelete: isOwn || isTeamMember,
    canManage: isTeamMember,
  })
})
