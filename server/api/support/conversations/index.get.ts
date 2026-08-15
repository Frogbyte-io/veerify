/**
 * @openapi
 * /api/support/conversations:
 *   get:
 *     tags: [Support]
 *     summary: List conversations in an inbox
 *     operationId: listSupportConversations
 *     parameters:
 *       - in: query
 *         name: inboxId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: assigneeUserId
 *         schema: { type: string }
 *       - in: query
 *         name: contactId
 *         schema: { type: string }
 *       - in: query
 *         name: tagId
 *         schema: { type: string }
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation page }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { z } from 'zod'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { db } from '~/server/database/drizzle'
import { conversation, conversationTag } from '~/server/database/schema/support'

const querySchema = z.object({
  inboxId: z.string().min(1),
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  assigneeUserId: z.string().optional(),
  contactId: z.string().optional(),
  tagId: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireInboxAccess(query.inboxId, session.user.id)

  const conditions = [eq(conversation.inboxId, query.inboxId)]

  if (query.status) conditions.push(eq(conversation.status, query.status))
  if (query.assigneeUserId) conditions.push(eq(conversation.assigneeUserId, query.assigneeUserId))
  if (query.contactId) conditions.push(eq(conversation.contactId, query.contactId))
  if (query.projectId) conditions.push(eq(conversation.projectId, query.projectId))

  if (query.tagId) {
    conditions.push(
      inArray(
        conversation.id,
        db
          .select({ id: conversationTag.conversationId })
          .from(conversationTag)
          .where(eq(conversationTag.tagId, query.tagId))
      )
    )
  }

  if (query.cursor) {
    const cursor = decodeListCursor(query.cursor, 'conversation')
    conditions.push(
      or(
        lt(conversation.createdAt, cursor.createdAt),
        and(eq(conversation.createdAt, cursor.createdAt), lt(conversation.id, cursor.id))
      )!
    )
  }

  const rows = await db
    .select()
    .from(conversation)
    .where(and(...conditions))
    .orderBy(desc(conversation.createdAt), desc(conversation.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows

  return createSuccessResponse({
    conversations: items,
    hasMore,
    nextCursor: hasMore
      ? encodeListCursor({ createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id })
      : null,
  })
})
