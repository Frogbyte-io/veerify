import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackSubscription } from '~/server/database/schema/feedback'

const unsubscribeSchema = z.object({
  email: z.string().email().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const body = await validateBody(event, unsubscribeSchema)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const [fb] = await db.select({ id: feedback.id }).from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  const subscriberEmail = session?.user ? session.user.email : body.email
  if (!subscriberEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Email is required'),
    })
  }

  await db
    .delete(feedbackSubscription)
    .where(and(eq(feedbackSubscription.feedbackId, id), eq(feedbackSubscription.email, subscriberEmail)))

  return createSuccessResponse({ subscribed: false })
})
