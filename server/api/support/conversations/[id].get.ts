/**
 * @openapi
 * /api/support/conversations/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get a conversation with its contact and participants
 *     operationId: getSupportConversation
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation detail }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contact, conversationParticipant } from '~/server/database/schema/support'
import { user } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string

  // Resolves through the inbox and throws 404/403 before anything is read.
  const row = await requireConversationAccess(conversationId, session.user.id)

  const [conversationContact] = await db.select().from(contact).where(eq(contact.id, row.contactId)).limit(1)

  // Participants carry either a contactId (a CC'd customer) or a userId (an
  // internal follower), never both - resolve each side's display fields so the
  // contact drawer doesn't need a second round trip per participant.
  const participantRows = await db
    .select({
      id: conversationParticipant.id,
      role: conversationParticipant.role,
      contactId: conversationParticipant.contactId,
      userId: conversationParticipant.userId,
      createdAt: conversationParticipant.createdAt,
      contactName: contact.name,
      contactEmail: contact.email,
      userName: user.name,
      userEmail: user.email,
    })
    .from(conversationParticipant)
    .leftJoin(contact, eq(conversationParticipant.contactId, contact.id))
    .leftJoin(user, eq(conversationParticipant.userId, user.id))
    .where(eq(conversationParticipant.conversationId, conversationId))

  return createSuccessResponse({
    conversation: row,
    contact: conversationContact ?? null,
    participants: participantRows,
  })
})
