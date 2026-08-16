/**
 * @openapi
 * /api/support/conversations/{id}/tags/{tagId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove a tag from a conversation
 *     operationId: removeSupportConversationTag
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: tagId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag removed }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found, or tag is not on the conversation }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { db } from '~/server/database/drizzle'
import { conversationTag } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const tagId = getRouterParam(event, 'tagId') as string

  const existing = await requireConversationAccess(conversationId, session.user.id)

  const [deleted] = await db
    .delete(conversationTag)
    .where(and(eq(conversationTag.conversationId, conversationId), eq(conversationTag.tagId, tagId)))
    .returning({ id: conversationTag.id })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Tag is not on this conversation'),
    })
  }

  // Same event as the add path - see the comment there.
  await publishConversationEvent({
    type: 'conversation.updated',
    teamId: existing.teamId,
    inboxId: existing.inboxId,
    conversationId,
  })

  return createSuccessResponse({ deleted: true })
})
