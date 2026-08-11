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
