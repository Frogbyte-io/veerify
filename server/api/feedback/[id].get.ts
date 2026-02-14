/**
 * Get Feedback Endpoint
 * Retrieves a single feedback item by ID
 *
 * @openapi
 * /api/feedback/{id}:
 *   get:
 *     tags: [Feedback]
 *     summary: Get feedback by ID
 *     description: Retrieves detailed information about a specific feedback item
 *     operationId: getFeedback
 *     parameters:
 *       - name: id
 *         in: path
 *         description: Feedback ID
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Feedback details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Feedback'
 *                     - type: object
 *                       properties:
 *                         author:
 *                           $ref: '#/components/schemas/User'
 *                         project:
 *                           $ref: '#/components/schemas/Project'
 *                         hasVoted:
 *                           type: boolean
 *                           description: Whether the current user has voted (if authenticated)
 *       404:
 *         description: Feedback not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, project, vote } from '~/server/database/schema/feedback'
import { user, teamMember } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  // Optional authentication - public endpoint
  const session = await optionalAuth(event)
  const anonSession = !session?.user ? await getAnonSession(event) : null

  // Rate limiting (relaxed for public read endpoint)
  await requireRateLimit(event, rateLimits.relaxed)

  // Get ID from route params
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Feedback ID is required'
      )
    })
  }

  // 1. Query feedback by ID with category
  const [result] = await db
    .select({
      feedback: feedback,
      category: feedbackCategory,
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(eq(feedback.id, id))
    .limit(1)

  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found')
    })
  }

  // 2. Get project information
  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, result.feedback.projectId))
    .limit(1)

  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found')
    })
  }

  // 3. Enforce access: authenticated users need team membership for private projects,
  //    anonymous users can only access public projects
  if (session?.user) {
    if (!proj.isPublic) {
      const [membership] = await db
        .select()
        .from(teamMember)
        .where(and(eq(teamMember.teamId, proj.teamId), eq(teamMember.userId, session.user.id)))
        .limit(1)

      if (!membership) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Forbidden',
          data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this project')
        })
      }
    }
  } else if (!proj.isPublic) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This project does not accept public access')
    })
  }

  // 4. Get author information (if feedback was created by a registered user)
  let author = null
  if (result.feedback.authorUserId) {
    const [authorRow] = await db
      .select({
        id: user.id,
        name: user.name,
        image: user.image,
      })
      .from(user)
      .where(eq(user.id, result.feedback.authorUserId))
      .limit(1)

    author = authorRow || null
  }

  // 5. Check if the current viewer has voted on this feedback
  let hasVoted = false
  if (session?.user) {
    const [existingVote] = await db
      .select({ id: vote.id })
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterUserId, session.user.id)))
      .limit(1)
    hasVoted = !!existingVote
  } else if (anonSession) {
    const [existingVote] = await db
      .select({ id: vote.id })
      .from(vote)
      .where(and(eq(vote.feedbackId, id), eq(vote.voterSessionId, anonSession.id)))
      .limit(1)
    hasVoted = !!existingVote
  }

  // 6. Return feedback with additional metadata
  return createSuccessResponse({
    ...result.feedback,
    category: result.category,
    author: author || (result.feedback.authorName ? { name: result.feedback.authorName } : null),
    project: {
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      isPublic: proj.isPublic,
    },
    hasVoted,
    isOwn: session?.user
      ? result.feedback.authorUserId === session.user.id
      : anonSession
        ? result.feedback.authorSessionId === anonSession.id
        : false,
  })
})
