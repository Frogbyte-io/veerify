/**
 * @openapi
 * /api/support/tags/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a tag
 *     description: >
 *       Hard delete. Conversations that used this tag have their SLA assignment
 *       recomputed and emit the usual conversation update and automation events.
 *     operationId: deleteSupportTag
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag deleted }
 *       403: { description: Not a member of the tag's team }
 *       404: { description: Tag not found }
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contact, conversation, conversationTag, supportTag } from '~/server/database/schema/support'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const tagId = getRouterParam(event, 'id') as string

  const [tag] = await db.select().from(supportTag).where(eq(supportTag.id, tagId)).limit(1)

  if (!tag) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Tag not found'),
    })
  }

  // Resolve-then-check (rather than a helper like `requireCompanyAccess`, since
  // there is no `requireTagAccess`) so a caller cannot delete another team's tag.
  await requireSupportTeamRole(tag.teamId, session.user.id, 'supervisor')

  const affected = await db
    .select({
      conversationId: conversation.id,
      teamId: conversation.teamId,
      inboxId: conversation.inboxId,
      priority: conversation.priority,
      contactId: conversation.contactId,
    })
    .from(conversationTag)
    .innerJoin(conversation, eq(conversation.id, conversationTag.conversationId))
    .where(eq(conversationTag.tagId, tagId))

  await db.transaction(async (tx) => {
    // The cascade removes the join rows. Recompute every affected conversation
    // before committing so SLA deadlines cannot retain the deleted tag.
    await tx.delete(supportTag).where(eq(supportTag.id, tagId))
    for (const row of affected) {
      const [contactRow] = await tx
        .select({ companyId: contact.companyId })
        .from(contact)
        .where(eq(contact.id, row.contactId))
        .limit(1)
      const tags = await tx
        .select({ tagId: conversationTag.tagId })
        .from(conversationTag)
        .where(eq(conversationTag.conversationId, row.conversationId))
      const sla = await resolveSlaAssignment(
        {
          teamId: row.teamId,
          inboxId: row.inboxId,
          priority: row.priority,
          companyId: contactRow?.companyId,
          tagIds: tags.map((tagRow) => tagRow.tagId),
          start: new Date(),
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
        .where(eq(conversation.id, row.conversationId))
    }
  })

  for (const row of affected) {
    await publishConversationEvent({
      type: 'conversation.updated',
      teamId: row.teamId,
      inboxId: row.inboxId,
      conversationId: row.conversationId,
    })
    await triggerAutomationEvent({
      conversationId: row.conversationId,
      trigger: 'conversation_updated',
      actorUserId: session.user.id,
    })
  }

  return createSuccessResponse({ deleted: true })
})
