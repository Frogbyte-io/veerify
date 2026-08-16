/**
 * @openapi
 * /api/support/conversations/{id}/tags:
 *   get:
 *     tags: [Support]
 *     summary: List a conversation's tags
 *     operationId: listSupportConversationTags
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag list }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { conversationTag, supportTag } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string

  await requireConversationAccess(conversationId, session.user.id)

  const tags = await db
    .select({
      id: supportTag.id,
      name: supportTag.name,
      color: supportTag.color,
      conversationTagId: conversationTag.id,
      createdAt: conversationTag.createdAt,
    })
    .from(conversationTag)
    .innerJoin(supportTag, eq(conversationTag.tagId, supportTag.id))
    .where(eq(conversationTag.conversationId, conversationId))
    .orderBy(asc(supportTag.name))

  return createSuccessResponse({ tags })
})
