/**
 * @openapi
 * /api/support/conversations/{id}/claim:
 *   post:
 *     tags: [Support]
 *     summary: Claim an unassigned conversation for the current agent
 *     description: >
 *       The null-owner condition and assignment activity are committed in one
 *       transaction. Concurrent claim attempts have one winner; later callers
 *       receive the current conversation with claimed=false.
 *     operationId: claimSupportConversation
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Claim outcome and current conversation }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { createError } from 'h3'
import { requireAuth } from '~/server/utils/auth-middleware'
import { claimConversationForAgent } from '~/server/utils/conversation-assignment'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireConversationAccess } from '~/server/utils/support-access'
import { publishConversationEvent } from '~/server/utils/support-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const existing = await requireConversationAccess(conversationId, session.user.id)
  const result = await claimConversationForAgent(conversationId, session.user.id)

  if (!result.conversation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Conversation not found'),
    })
  }

  if (result.claimed) {
    await publishConversationEvent({
      type: 'conversation.updated',
      teamId: existing.teamId,
      inboxId: existing.inboxId,
      conversationId,
    })
  }

  return createSuccessResponse(result)
})
