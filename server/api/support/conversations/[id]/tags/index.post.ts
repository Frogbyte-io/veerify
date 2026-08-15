/**
 * @openapi
 * /api/support/conversations/{id}/tags:
 *   post:
 *     tags: [Support]
 *     summary: Add a tag to a conversation
 *     operationId: addSupportConversationTag
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag added }
 *       400: { description: Tag is not part of this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 *       409: { description: This tag is already on the conversation }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversationTag, supportTag } from '~/server/database/schema/support'

const bodySchema = z.object({
  tagId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // A foreign key proves the tag exists, not that it belongs to this
  // conversation's team - without this check one team could tag another
  // team's conversation.
  const [tag] = await db.select().from(supportTag).where(eq(supportTag.id, body.tagId)).limit(1)

  if (!tag || tag.teamId !== existing.teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Tag is not part of this team'),
    })
  }

  try {
    const [created] = await db
      .insert(conversationTag)
      .values({
        id: randomUUID(),
        conversationId,
        tagId: body.tagId,
        createdAt: new Date(),
      })
      .returning()

    // `conversation.updated` rather than a bespoke type - envelopes carry no
    // detail and clients refetch, so reusing the type PATCH already emits
    // means the UI needs no new handler.
    await publishConversationEvent({
      type: 'conversation.updated',
      teamId: existing.teamId,
      inboxId: existing.inboxId,
      conversationId,
    })

    return createSuccessResponse({ tag: created })
  } catch (error) {
    // `conversationTag` is uniquely indexed on (conversationId, tagId) - two
    // concurrent adds can both pass a pre-check and one still fails, so the
    // constraint is the real arbiter, not a SELECT before the insert.
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This tag is already on the conversation'),
      })
    }
    throw error
  }
})
