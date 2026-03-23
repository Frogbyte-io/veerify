import { z } from 'zod'
import { eq, desc, and, lt, sql } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { notification } from '~/server/database/schema/feedback'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = querySchema.parse(getQuery(event))

  const conditions = [eq(notification.userId, session.user.id)]

  if (query.unreadOnly) {
    conditions.push(eq(notification.isRead, false))
  }

  if (query.cursor) {
    conditions.push(lt(notification.createdAt, new Date(query.cursor)))
  }

  const notifications = await db
    .select()
    .from(notification)
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(query.limit + 1)

  const hasMore = notifications.length > query.limit
  const items = hasMore ? notifications.slice(0, query.limit) : notifications
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

  // Get unread count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.userId, session.user.id), eq(notification.isRead, false)))

  return createSuccessResponse({
    notifications: items,
    unreadCount: countResult?.count ?? 0,
    nextCursor,
    hasMore,
  })
})
