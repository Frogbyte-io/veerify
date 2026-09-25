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
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, conversation, conversationTag, supportTag } from '~/server/database/schema/support'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'

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
    const created = await db.transaction(async (tx) => {
      const [createdTag] = await tx
        .insert(conversationTag)
        .values({
          id: randomUUID(),
          conversationId,
          tagId: body.tagId,
          createdAt: new Date(),
        })
        .returning()

      const [contactRow] = await tx
        .select({ companyId: contact.companyId })
        .from(contact)
        .where(eq(contact.id, existing.contactId))
        .limit(1)
      const tags = await tx
        .select({ tagId: conversationTag.tagId })
        .from(conversationTag)
        .where(eq(conversationTag.conversationId, conversationId))
      const sla = await resolveSlaAssignment(
        {
          teamId: existing.teamId,
          inboxId: existing.inboxId,
          priority: existing.priority,
          companyId: contactRow?.companyId,
          tagIds: tags.map((row) => row.tagId),
          start: new Date(),
          includeNextResponse: Boolean(existing.firstResponseAt),
        },
        tx
      )
      await tx
        .update(conversation)
        .set({
          ...(sla ?? {
            slaPolicyId: null,
            firstResponseDueAt: null,
            nextResponseDueAt: null,
            resolutionDueAt: null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, conversationId))

      return createdTag
    })

    // `conversation.updated` rather than a bespoke type - envelopes carry no
    // detail and clients refetch, so reusing the type PATCH already emits
    // means the UI needs no new handler.
    await publishConversationEvent({
      type: 'conversation.updated',
      teamId: existing.teamId,
      inboxId: existing.inboxId,
      conversationId,
    })
    await triggerAutomationEvent({ conversationId, trigger: 'conversation_updated', actorUserId: session.user.id })

    // Automation may add/remove tags. Re-read after it completes so the SLA
    // assignment reflects the final tag set rather than the pre-automation set.
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          teamId: conversation.teamId,
          inboxId: conversation.inboxId,
          contactId: conversation.contactId,
          priority: conversation.priority,
          firstResponseAt: conversation.firstResponseAt,
        })
        .from(conversation)
        .where(eq(conversation.id, conversationId))
        .limit(1)
      if (!current) return
      const [contactRow] = await tx
        .select({ companyId: contact.companyId })
        .from(contact)
        .where(eq(contact.id, current.contactId))
        .limit(1)
      const tags = await tx
        .select({ tagId: conversationTag.tagId })
        .from(conversationTag)
        .where(eq(conversationTag.conversationId, conversationId))
      const sla = await resolveSlaAssignment(
        {
          teamId: current.teamId,
          inboxId: current.inboxId,
          priority: current.priority,
          companyId: contactRow?.companyId,
          tagIds: tags.map((row) => row.tagId),
          start: new Date(),
          includeNextResponse: Boolean(current.firstResponseAt),
        },
        tx
      )
      await tx
        .update(conversation)
        .set({
          ...(sla ?? { slaPolicyId: null, firstResponseDueAt: null, nextResponseDueAt: null, resolutionDueAt: null }),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, conversationId))
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
