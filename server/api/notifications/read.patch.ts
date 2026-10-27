/**
 * @openapi
 * /api/notifications/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark notifications read
 *     description: >
 *       Marks one notification read when `id` is given, otherwise marks all of the caller's unread notifications read. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: markNotificationsRead
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string, description: "Notification id; omit to mark every unread notification read" }
 *     responses:
 *       200: { description: "With id: the updated notification. Without id: { markedRead: number }" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       404: { description: "Notification not found or not owned by the caller" }
 */
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { notification } from '~/server/database/schema/notifications'

const readSchema = z.object({
  // If id is provided, mark that single notification as read.
  // If omitted, mark ALL unread notifications as read.
  id: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readBody(event)
  const parsed = readSchema.parse(body || {})

  const now = new Date()

  if (parsed.id) {
    // Mark a single notification as read
    const [updated] = await db
      .update(notification)
      .set({ isRead: true, readAt: now })
      .where(and(eq(notification.id, parsed.id), eq(notification.userId, session.user.id)))
      .returning()

    if (!updated) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Notification not found'),
      })
    }

    return createSuccessResponse(updated)
  }

  // Mark all unread notifications as read
  const updated = await db
    .update(notification)
    .set({ isRead: true, readAt: now })
    .where(and(eq(notification.userId, session.user.id), eq(notification.isRead, false)))
    .returning()

  return createSuccessResponse({ markedRead: updated.length })
})
