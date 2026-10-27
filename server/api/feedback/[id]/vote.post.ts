/**
 * @openapi
 * /api/feedback/{id}/vote:
 *   post:
 *     tags: [Feedback]
 *     summary: Vote on feedback
 *     description: >
 *       Casts, switches or removes a vote: the same type again removes the vote, the opposite type switches direction. Authentication is optional: anonymous callers are accepted subject to public project and product rules. Signed-in callers may use a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       The project and product of the feedback must be public, even for signed-in callers. Anonymous votes are tracked by an anonymous session cookie. Rate limited.
 *     operationId: voteOnFeedback
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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [upvote, downvote], default: upvote, description: "An invalid or missing body falls back to upvote" }
 *     responses:
 *       200: { description: "data is { voted, voteType, voteCount }; voted is false when the vote was removed" }
 *       401: { description: "Invalid personal API key" }
 *       403: { description: "Project is not public" }
 *       404: { description: "Feedback not found" }
 *       429: { description: "Rate limit exceeded" }
 */
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'
import { feedback, vote } from '~/server/database/schema/feedback'
import { requirePublicFeedback } from '~/server/utils/feedback-access'

const bodySchema = z.object({
  type: z.enum(['upvote', 'downvote']).default('upvote'),
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.relaxed, identifier: 'feedback-vote' })

  const session = await optionalAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  // Parse vote type from body (defaults to 'upvote' for backward compat)
  const rawBody = await readBody(event).catch(() => ({}))
  const parsed = bodySchema.safeParse(rawBody || {})
  const voteType = parsed.success ? parsed.data.type : 'upvote'

  // Check feedback exists
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Verify the feedback's project is public (voting is public-facing feature)
  await requirePublicFeedback(fb)

  // Determine voter identity: authenticated user or anonymous session
  const userId = session?.user?.id || null
  let anonSessionId: string | null = null

  if (!userId) {
    const anonSession = await getOrCreateAnonSession(event)
    anonSessionId = anonSession.id
  }

  // Build the condition for finding an existing vote
  const voteCondition = userId
    ? and(eq(vote.feedbackId, id), eq(vote.voterUserId, userId))
    : and(eq(vote.feedbackId, id), eq(vote.voterSessionId, anonSessionId!))

  const [existingVote] = await db.select().from(vote).where(voteCondition).limit(1)

  if (existingVote) {
    if (existingVote.type === voteType) {
      // Same type → toggle off (remove vote)
      await db.delete(vote).where(eq(vote.id, existingVote.id))
      // Upvote removed: count -1; downvote removed: count +1
      const delta = voteType === 'upvote' ? -1 : 1
      await db
        .update(feedback)
        .set({ voteCount: sql`${feedback.voteCount} + ${delta}`, updatedAt: new Date() })
        .where(eq(feedback.id, id))

      const [updated] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
      return createSuccessResponse({ voted: false, voteType: null, voteCount: updated.voteCount })
    } else {
      // Different type → switch vote direction
      await db.update(vote).set({ type: voteType }).where(eq(vote.id, existingVote.id))
      // Switching from downvote to upvote: +2; from upvote to downvote: -2
      const delta = voteType === 'upvote' ? 2 : -2
      await db
        .update(feedback)
        .set({ voteCount: sql`${feedback.voteCount} + ${delta}`, updatedAt: new Date() })
        .where(eq(feedback.id, id))

      const [updated] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
      return createSuccessResponse({ voted: true, voteType, voteCount: updated.voteCount })
    }
  } else {
    // No existing vote → add new vote
    await db.insert(vote).values({
      id: crypto.randomUUID(),
      feedbackId: id,
      voterUserId: userId,
      voterSessionId: anonSessionId,
      type: voteType,
      createdAt: new Date(),
    })
    // Upvote: +1; downvote: -1
    const delta = voteType === 'upvote' ? 1 : -1
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} + ${delta}`, updatedAt: new Date() })
      .where(eq(feedback.id, id))

    const [updated] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
    return createSuccessResponse({ voted: true, voteType, voteCount: updated.voteCount })
  }
})
