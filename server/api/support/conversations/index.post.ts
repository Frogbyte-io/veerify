/**
 * @openapi
 * /api/support/conversations:
 *   post:
 *     tags: [Support]
 *     summary: Create a conversation
 *     description: >
 *       Stage 02's manual entry point - no mail pipeline yet. Creates the
 *       ticket shell only; messages are added afterward via
 *       /conversations/{id}/messages.
 *     operationId: createSupportConversation
 *     responses:
 *       200: { description: Conversation created }
 *       400: { description: contactId or projectId does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, conversation } from '~/server/database/schema/support'
import { project } from '~/server/database/schema/feedback'

const bodySchema = z.object({
  inboxId: z.string().min(1),
  contactId: z.string().min(1),
  subject: z.string().trim().max(500).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  projectId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxAccess(body.inboxId, session.user.id)

  const [matchedContact] = await db
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.id, body.contactId), eq(contact.teamId, inbox.teamId)))
    .limit(1)

  if (!matchedContact) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Contact is not part of this team'),
    })
  }

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, inbox.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  // Falls back to the inbox's own product link when the request doesn't pick
  // one - the single-product case from delta D-27 shouldn't require every
  // manual ticket to specify a projectId that only ever has one value anyway.
  const projectId = body.projectId ?? inbox.projectId ?? null

  const now = new Date()
  const conversationId = randomUUID()

  const created = await db.transaction(async (tx) => {
    const displayId = await allocateConversationDisplayId(tx, inbox.teamId)

    const [row] = await tx
      .insert(conversation)
      .values({
        id: conversationId,
        inboxId: inbox.id,
        teamId: inbox.teamId,
        contactId: body.contactId,
        projectId,
        displayId,
        subject: body.subject ?? null,
        priority: body.priority ?? null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return row
  })

  await publishConversationEvent({
    type: 'conversation.created',
    teamId: inbox.teamId,
    inboxId: inbox.id,
    conversationId,
  })

  return createSuccessResponse({ conversation: created })
})
