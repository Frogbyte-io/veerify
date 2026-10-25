/**
 * @openapi
 * /api/support/conversations/{id}/feedback:
 *   post:
 *     tags: [Support]
 *     summary: Convert a support conversation into feedback
 *     description: >
 *       Creates an agent-authored feedback item, links it to the conversation,
 *       and records the contact link and private activity entry in one
 *       transaction. The product defaults to the conversation's resolved
 *       inbox/address attribution when the caller does not provide one.
 *     operationId: convertSupportConversationToFeedback
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Feedback created and conversation linked }
 *       400: { description: Invalid product or category selection }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Conversation not found }
 *       409: { description: Conversation already has linked feedback }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { db } from '~/server/database/drizzle'
import { contactLink, conversation, conversationMessage } from '~/server/database/schema/support'
import { feedback, feedbackCategory, product } from '~/server/database/schema/feedback'

const bodySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
  body: z
    .string()
    .trim()
    .max(5000, 'Description too long')
    .nullable()
    .optional()
    .transform((value) => value || null),
  productId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  // Resolve the inbox boundary before entering the transaction. The row is
  // locked and re-read below so a concurrent conversion cannot create two
  // feedback records for the same conversation.
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

    const projectId = lockedConversation.projectId
    const [matchedProduct] = body.productId
      ? await tx
          .select({ id: product.id })
          .from(product)
          .where(and(eq(product.id, body.productId), eq(product.projectId, projectId)))
          .limit(1)
      : await tx
          .select({ id: product.id })
          .from(product)
          .where(eq(product.projectId, projectId))
          .orderBy(asc(product.sortOrder), asc(product.createdAt), asc(product.id))
          .limit(1)

    if (!matchedProduct) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Product is not part of this project'),
      })
    }

    const categoryId = body.categoryId ?? null
    if (categoryId) {
      const [matchedCategory] = await tx
        .select({ id: feedbackCategory.id })
        .from(feedbackCategory)
        .where(and(eq(feedbackCategory.id, categoryId), eq(feedbackCategory.projectId, projectId)))
        .limit(1)

      if (!matchedCategory) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Category is not part of this project'),
        })
      }
    }

    const feedbackId = randomUUID()
    const [createdFeedback] = await tx
      .insert(feedback)
      .values({
        id: feedbackId,
        projectId,
        productId: matchedProduct.id,
        categoryId,
        title: body.title,
        body: body.body,
        status: 'open',
        authorUserId: session.user.id,
        authorSessionId: null,
        authorName: session.user.name,
        authorEmail: session.user.email,
        voteCount: 0,
        commentCount: 0,
        isPinned: false,
        isLocked: false,
        isHidden: false,
        metadata: { source: 'support_conversation' },
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    const [link] = await tx
      .insert(contactLink)
      .values({
        id: randomUUID(),
        contactId: lockedConversation.contactId,
        entityType: 'feedback',
        entityId: createdFeedback.id,
        source: 'agent',
        createdByUserId: session.user.id,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [contactLink.contactId, contactLink.entityType, contactLink.entityId] })
      .returning()

    const [updatedConversation] = await tx
      .update(conversation)
      .set({ linkedFeedbackId: createdFeedback.id, lastActivityAt: now, updatedAt: now })
      .where(eq(conversation.id, conversationId))
      .returning()

    await tx.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId,
      kind: 'activity',
      body: `Linked conversation to feedback "${createdFeedback.title}".`,
      senderKind: 'system',
      senderUserId: session.user.id,
      isPrivate: true,
      createdAt: now,
    })

    return { feedback: createdFeedback, conversation: updatedConversation, link: link ?? null }
  })

  await publishConversationEvent({
    type: 'conversation.updated',
    projectId: accessibleConversation.projectId,
    inboxId: accessibleConversation.inboxId,
    conversationId,
  })
  await triggerAutomationEvent({ conversationId, trigger: 'conversation_updated', actorUserId: session.user.id })

  return createSuccessResponse(result)
})
