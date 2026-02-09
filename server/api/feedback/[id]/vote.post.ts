import { eq, and, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { feedback, vote } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  // Check feedback exists
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

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
    // Remove vote (toggle off)
    await db.delete(vote).where(eq(vote.id, existingVote.id))
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} - 1`, updatedAt: new Date() })
      .where(eq(feedback.id, id))

    const [updated] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
    return createSuccessResponse({ voted: false, voteCount: updated.voteCount })
  } else {
    // Add vote
    await db.insert(vote).values({
      id: crypto.randomUUID(),
      feedbackId: id,
      voterUserId: userId,
      voterSessionId: anonSessionId,
      createdAt: new Date(),
    })
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} + 1`, updatedAt: new Date() })
      .where(eq(feedback.id, id))

    const [updated] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
    return createSuccessResponse({ voted: true, voteCount: updated.voteCount })
  }
})
