import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackSubscription } from '~/server/database/schema/feedback'
import { sendStatusChangeNotificationEmail } from '~/lib/email'

const updateStatusSchema = z.object({
  status: z.string().trim().min(1).max(80),
})

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

  const body = await validateBody(event, updateStatusSchema)

  // Verify feedback exists
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Only team members can change status
  await requireProjectAccess(fb.projectId, session.user.id)

  const now = new Date()
  const [updated] = await db
    .update(feedback)
    .set({ status: body.status, updatedAt: now })
    .where(eq(feedback.id, id))
    .returning()

  // Notify subscribers about the status change (fire-and-forget)
  if (updated.status !== fb.status) {
    db.select()
      .from(feedbackSubscription)
      .where(eq(feedbackSubscription.feedbackId, id))
      .then((subscribers) => {
        const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
        for (const sub of subscribers) {
          const unsubscribeUrl = `${baseUrl}/api/feedback/${id}/unsubscribe?token=${sub.token}`
          const boardUrl = baseUrl
          sendStatusChangeNotificationEmail({
            to: sub.email,
            feedbackTitle: updated.title,
            newStatus: updated.status,
            boardUrl,
            unsubscribeUrl,
          }).catch((err) => console.error('Failed to send status notification:', err))
        }
      })
      .catch((err) => console.error('Failed to fetch subscribers for status notification:', err))
  }

  return createSuccessResponse(updated)
})
