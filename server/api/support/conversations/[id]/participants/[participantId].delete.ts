/**
 * @openapi
 * /api/support/conversations/{id}/participants/{participantId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove a CC or follower from a conversation
 *     operationId: removeSupportConversationParticipant
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: participantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Participant removed }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation or participant not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { db } from '~/server/database/drizzle'
import { conversationParticipant } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const participantId = getRouterParam(event, 'participantId') as string

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // Scoping the delete to conversationId prevents deleting another
  // conversation's participant by id.
  const [deleted] = await db
    .delete(conversationParticipant)
    .where(and(eq(conversationParticipant.id, participantId), eq(conversationParticipant.conversationId, conversationId)))
    .returning({ id: conversationParticipant.id })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Participant not found on this conversation'),
    })
  }

  await publishConversationEvent({
    type: 'conversation.updated',
    teamId: existing.teamId,
    inboxId: existing.inboxId,
    conversationId,
  })

  return createSuccessResponse({ deleted: true })
})
