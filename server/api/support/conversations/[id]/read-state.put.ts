/**
 * @openapi
 * /api/support/conversations/{id}/read-state:
 *   put:
 *     tags: [Support]
 *     summary: Mark a conversation read or unread for the current agent
 *     operationId: updateSupportConversationReadState
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { isConversationUnread, setConversationReadState } from '~/server/utils/conversation-read-state'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ isUnread: z.boolean() }).strict()

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)
  const existing = await requireConversationAccess(conversationId, session.user.id)

  const { conversation, readState } = await setConversationReadState(
    conversationId,
    session.user.id,
    body.isUnread,
    existing.lastCustomerReplyAt ?? existing.createdAt
  )
  const isUnread = isConversationUnread(
    {
      ...conversation,
      lastReadAt: readState?.lastReadAt ?? null,
    },
    session.user.id
  )

  return createSuccessResponse({ readState, isUnread })
})
