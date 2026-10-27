/**
 * @openapi
 * /api/notifications/{id}:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete notification
 *     description: >
 *       Deletes one of the caller's notifications. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: deleteNotification
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: "Notification id"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Deleted; data is { deleted: true }" }
 *       401: { description: "Not authenticated" }
 *       404: { description: "Notification not found or not owned by the caller" }
 */
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { notification } from '~/server/database/schema/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Notification ID is required'),
    })
  }

  const [deleted] = await db
    .delete(notification)
    .where(and(eq(notification.id, id), eq(notification.userId, session.user.id)))
    .returning()

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Notification not found'),
    })
  }

  return createSuccessResponse({ deleted: true })
})
