import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackStatus, feedbackSubscription } from '~/server/database/schema/feedback'
import { sendStatusChangeNotificationEmail } from '~/lib/email'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { createLogger } from '~/server/utils/logger'
import { notifyProjectTeam, notifyFeedbackSubscribers } from '~/server/utils/notifications'

const logger = createLogger('feedback')

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

  // Validate that the provided status is allowed for this project
  const customStatuses = await db.select().from(feedbackStatus).where(eq(feedbackStatus.projectId, fb.projectId))
  const allowedValues =
    customStatuses.length > 0 ? customStatuses.map((s) => s.value) : SYSTEM_STATUSES.map((s) => s.value)

  if (!allowedValues.includes(body.status)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `Invalid status. Allowed values: ${allowedValues.join(', ')}`
      ),
    })
  }

  const now = new Date()
  const [updated] = await db
    .update(feedback)
    .set({ status: body.status, updatedAt: now })
    .where(eq(feedback.id, id))
    .returning()

  // Notify about the status change
  if (updated.status !== fb.status) {
    const notifParams = {
      type: 'status_change' as const,
      title: `Status changed to "${updated.status}"`,
      body: updated.title,
      link: `/feedback?id=${id}`,
      feedbackId: id,
      actorUserId: session.user.id,
      actorName: session.user.name,
    }

    // In-app notifications for team members
    notifyProjectTeam(fb.projectId, session.user.id, notifParams)

    // In-app notifications for non-team-member subscribers (app/both channel)
    notifyFeedbackSubscribers(id, session.user.id, [], {
      ...notifParams,
      projectId: fb.projectId,
    })

    // Email notifications for subscribers (email/both channel)
    try {
      const subscribers = await db.select().from(feedbackSubscription).where(eq(feedbackSubscription.feedbackId, id))
      const emailRecipients = subscribers.filter((s) => s.notifyChannel === 'email' || s.notifyChannel === 'both')

      const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
      const notificationResults = await Promise.allSettled(
        emailRecipients.map((sub) => {
          const unsubscribeUrl = `${baseUrl}/api/feedback/${id}/unsubscribe?token=${sub.token}`
          const boardUrl = baseUrl
          return sendStatusChangeNotificationEmail({
            to: sub.email,
            feedbackTitle: updated.title,
            newStatus: updated.status,
            boardUrl,
            unsubscribeUrl,
          })
        })
      )

      for (const [index, result] of notificationResults.entries()) {
        if (result.status === 'rejected') {
          logger.error('Failed to send status notification', {
            feedbackId: id,
            email: emailRecipients[index]?.email,
            error: result.reason instanceof Error ? result.reason.message : result.reason,
          })
        }
      }
    } catch (err) {
      logger.error('Failed to fetch subscribers for status notification', {
        feedbackId: id,
        error: err instanceof Error ? err.message : err,
      })
    }
  }

  return createSuccessResponse(updated)
})
