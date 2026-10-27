/**
 * @openapi
 * /api/notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread notification count
 *     description: >
 *       Returns the number of unread notifications. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getUnreadNotificationCount
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "{ unreadCount: number }" }
 *       401: { description: "Not authenticated" }
 */
import { eq, and, sql } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { notification } from '~/server/database/schema/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.userId, session.user.id), eq(notification.isRead, false)))

  return createSuccessResponse({ unreadCount: result?.count ?? 0 })
})
