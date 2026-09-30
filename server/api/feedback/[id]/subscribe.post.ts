import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackSubscription } from '~/server/database/schema/feedback'
import { sendFeedbackSubscriptionConfirmationEmail } from '~/lib/email'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('feedback')

const subscribeSchema = z.object({
  email: z.string().email().optional(),
  // Notification channel: 'email' (default), 'app' (in-app only), or 'both'
  // Anonymous users are always 'email' regardless of what they pass
  channel: z.enum(['email', 'app', 'both']).optional().default('email'),
})

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const body = await validateBody(event, subscribeSchema)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Check access: team members can subscribe to private projects, otherwise must be public
  if (session?.user) {
    try {
      await requireProjectAccess(fb.projectId, session.user.id)
    } catch {
      await requirePublicProject(fb.projectId)
    }
  } else {
    await requirePublicProject(fb.projectId)
  }

  // Determine subscriber email
  const subscriberEmail = session?.user ? session.user.email : body.email
  if (!subscriberEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Email is required'),
    })
  }

  // Anonymous users can only use email channel (no account for in-app)
  const notifyChannel = session?.user ? body.channel : 'email'

  // Check if already subscribed
  const [existing] = await db
    .select()
    .from(feedbackSubscription)
    .where(and(eq(feedbackSubscription.feedbackId, id), eq(feedbackSubscription.email, subscriberEmail)))
    .limit(1)

  if (existing) {
    // Update channel preference if it changed
    if (existing.notifyChannel !== notifyChannel) {
      await db.update(feedbackSubscription).set({ notifyChannel }).where(eq(feedbackSubscription.id, existing.id))
    }
    return createSuccessResponse({ subscribed: true, email: subscriberEmail, channel: notifyChannel })
  }

  const token = crypto.randomUUID()
  await db.insert(feedbackSubscription).values({
    id: crypto.randomUUID(),
    feedbackId: id,
    email: subscriberEmail,
    userId: session?.user?.id || null,
    notifyChannel,
    token,
    createdAt: new Date(),
  })

  // Send confirmation to anonymous subscribers (logged-in users already know their email)
  if (!session?.user) {
    const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
    const unsubscribeUrl = `${baseUrl}/api/feedback/${id}/unsubscribe?token=${token}`
    sendFeedbackSubscriptionConfirmationEmail({
      to: subscriberEmail,
      feedbackTitle: fb.title,
      unsubscribeUrl,
    }).catch((err) =>
      logger.error('Failed to send subscription confirmation email', {
        feedbackId: id,
        error: err instanceof Error ? err.message : err,
      })
    )
  }

  setResponseStatus(event, 201)
  return createSuccessResponse({ subscribed: true, email: subscriberEmail, channel: notifyChannel })
})
