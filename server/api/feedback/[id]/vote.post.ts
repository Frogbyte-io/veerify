import { eq, and, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { feedback, vote } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

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

  // Check if user already voted
  const [existingVote] = await db
    .select()
    .from(vote)
    .where(and(eq(vote.feedbackId, id), eq(vote.voterUserId, session.user.id)))
    .limit(1)

  if (existingVote) {
    // Remove vote
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
      voterUserId: session.user.id,
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
