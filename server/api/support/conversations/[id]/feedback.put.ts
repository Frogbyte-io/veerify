/**
 * @openapi
 * /api/support/conversations/{id}/feedback:
 *   put:
 *     tags: [Support]
 *     summary: Link an existing feedback item to a conversation
 *     operationId: linkSupportConversationFeedback
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Feedback linked }
 *       400: { description: Feedback is not part of this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation or feedback not found }
 *       409: { description: Conversation already has linked feedback }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { db } from '~/server/database/drizzle'
import { contactLink, conversation, conversationMessage } from '~/server/database/schema/support'
import { feedback, project } from '~/server/database/schema/feedback'

const bodySchema = z.object({ feedbackId: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)
  const accessibleConversation = await requireConversationAccess(conversationId, session.user.id)
  const now = new Date()

  const result = await db.transaction(async (tx) => {
    const [lockedConversation] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .for('update')
      .limit(1)

    if (!lockedConversation) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Conversation not found'),
      })
    }

    if (lockedConversation.linkedFeedbackId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This conversation is already linked to feedback'),
      })
    }

    const [target] = await tx
      .select({ id: feedback.id, title: feedback.title })
      .from(feedback)
      .innerJoin(project, eq(project.id, feedback.projectId))
      .where(and(eq(feedback.id, body.feedbackId), eq(project.teamId, lockedConversation.teamId)))
      .limit(1)

    if (!target) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback is not part of this team'),
      })
    }

    const [link] = await tx
      .insert(contactLink)
      .values({
        id: randomUUID(),
        contactId: lockedConversation.contactId,
        entityType: 'feedback',
        entityId: target.id,
        source: 'agent',
        createdByUserId: session.user.id,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [contactLink.contactId, contactLink.entityType, contactLink.entityId] })
      .returning()

    const [updatedConversation] = await tx
      .update(conversation)
      .set({ linkedFeedbackId: target.id, lastActivityAt: now, updatedAt: now })
      .where(eq(conversation.id, conversationId))
      .returning()

    await tx.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId,
      kind: 'activity',
      body: `Linked conversation to feedback "${target.title}".`,
      senderKind: 'system',
      senderUserId: session.user.id,
      isPrivate: true,
      createdAt: now,
    })

    return { conversation: updatedConversation, link: link ?? null, feedback: target }
  })

  await publishConversationEvent({
    type: 'conversation.updated',
    teamId: accessibleConversation.teamId,
    inboxId: accessibleConversation.inboxId,
    conversationId,
  })

  return createSuccessResponse(result)
})
