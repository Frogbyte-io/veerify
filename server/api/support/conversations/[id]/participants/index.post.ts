/**
 * @openapi
 * /api/support/conversations/{id}/participants:
 *   post:
 *     tags: [Support]
 *     summary: Add a CC or follower to a conversation
 *     description: >
 *       A participant is either a CC'd customer (`contactId`) or an internal
 *       follower (`userId`) - never both. Exactly one of the two must be set.
 *     operationId: addSupportConversationParticipant
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Participant added }
 *       400: { description: Neither or both of contactId/userId set, or the target does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 *       409: { description: This participant is already on the conversation }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { db } from '~/server/database/drizzle'
import { contact, conversationParticipant } from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'

const bodySchema = z
  .object({
    contactId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    role: z.enum(['cc', 'follower']),
  })
  // A row with both set (or neither) is meaningless - the DB has no
  // constraint that catches this, so it's enforced here.
  .refine((data) => Boolean(data.contactId) !== Boolean(data.userId), {
    message: 'Exactly one of contactId or userId must be set',
  })
  .refine((data) => !data.contactId || data.role === 'cc', {
    message: 'Contact participants must use the cc role',
    path: ['role'],
  })
  .refine((data) => !data.userId || data.role === 'follower', {
    message: 'User participants must use the follower role',
    path: ['role'],
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // A foreign key proves the contact/user exists, not that it belongs to
  // this conversation's team - same cross-tenant gap Stage 01 closed for
  // contacts.
  if (body.contactId) {
    const [matchedContact] = await db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.id, body.contactId), eq(contact.teamId, existing.teamId)))
      .limit(1)

    if (!matchedContact) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Contact is not part of this team'),
      })
    }
  }

  if (body.userId) {
    const [matchedMember] = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, existing.teamId), eq(teamMember.userId, body.userId)))
      .limit(1)

    if (!matchedMember) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'User is not a member of this team'),
      })
    }
  }

  try {
    const [created] = await db
      .insert(conversationParticipant)
      .values({
        id: randomUUID(),
        conversationId,
        contactId: body.contactId ?? null,
        userId: body.userId ?? null,
        role: body.role,
        createdAt: new Date(),
      })
      .returning()

    // Reuses 'conversation.updated' rather than a bespoke type - envelopes
    // carry no detail and clients refetch, so the PATCH endpoint's handler
    // already covers this without the UI needing a new event type.
    // publishRealtime swallows its own errors, so this cannot turn a
    // successful write into a failed request.
    await publishConversationEvent({
      type: 'conversation.updated',
      teamId: existing.teamId,
      inboxId: existing.inboxId,
      conversationId,
    })

    return createSuccessResponse({ participant: created })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This participant is already on the conversation'),
      })
    }
    throw error
  }
})
