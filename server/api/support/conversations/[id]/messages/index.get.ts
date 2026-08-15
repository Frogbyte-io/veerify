/**
 * @openapi
 * /api/support/conversations/{id}/messages:
 *   get:
 *     tags: [Support]
 *     summary: Get a conversation's message thread
 *     description: >
 *       Returns the most recent window of messages in ascending (oldest-first)
 *       order, ready to render as a chat thread. `hasMore: true` means older
 *       history exists above the returned window - this endpoint always
 *       anchors to the newest messages, never to an arbitrary page. All
 *       kinds (`incoming`, `outgoing`, `note`, `activity`) are included,
 *       private notes too, since this is the agent-facing thread pane.
 *     operationId: listSupportConversationMessages
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
 *     responses:
 *       200: { description: Message thread, oldest first }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversationMessage } from '~/server/database/schema/support'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const query = validateQuery(event, querySchema)

  await requireConversationAccess(conversationId, session.user.id)

  // Fetch the newest window in descending order, then reverse it into the
  // ascending order the thread pane renders - a plain ascending scan with
  // OFFSET would have to walk the entire history to find the tail.
  const rows = await db
    .select()
    .from(conversationMessage)
    .where(eq(conversationMessage.conversationId, conversationId))
    .orderBy(desc(conversationMessage.createdAt), desc(conversationMessage.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = (hasMore ? rows.slice(0, query.limit) : rows).reverse()

  return createSuccessResponse({
    messages: items,
    hasMore,
  })
})
