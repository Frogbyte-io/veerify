/**
 * @openapi
 * /api/support/conversations/{id}:
 *   patch:
 *     tags: [Support]
 *     summary: Update a conversation's status, priority, assignee, subject, or product
 *     description: >
 *       Every status, priority, assignee, and product change also writes an
 *       `activity` message into the thread, in the same transaction as the
 *       update. Subject changes deliberately do not - they are not an
 *       operational event worth an inline feed entry.
 *     operationId: updateSupportConversation
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation updated }
 *       400: { description: assigneeUserId or projectId does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { diffConversationPatch, recordConversationActivity } from '~/server/utils/conversation-activity'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { notifyUser } from '~/server/utils/notifications'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversation } from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'
import { project } from '~/server/database/schema/feedback'

const bodySchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  subject: z.string().trim().max(500).nullable().optional(),
  projectId: z.string().nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // A foreign key proves the user and project exist, not that they belong to
  // this conversation's team - same cross-tenant gap Stage 01 closed for
  // contacts and companies.
  if (body.assigneeUserId) {
    const [membership] = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, existing.teamId), eq(teamMember.userId, body.assigneeUserId)))
      .limit(1)

    if (!membership) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Assignee is not a member of this team'),
      })
    }
  }

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, existing.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  const now = new Date()
  const { changes, updates } = diffConversationPatch(existing, body, now)

  if (Object.keys(updates).length === 0) {
    return createSuccessResponse({ conversation: existing, changed: false })
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(conversation)
      .set({ ...updates, lastActivityAt: now, updatedAt: now })
      .where(eq(conversation.id, conversationId))
      .returning()

    // Same transaction as the update it describes, so the two can never
    // diverge.
    await recordConversationActivity(tx, conversationId, changes, session.user.id)

    return row
  })

  await publishConversationEvent({
    type: 'conversation.updated',
    teamId: existing.teamId,
    inboxId: existing.inboxId,
    conversationId,
  })

  // Tell the new assignee they now own this ticket. Fire-and-forget: a
  // notification failure must not turn a successful update into a failed
  // request, and `notifyUser` swallows its own errors. Self-assignment is
  // skipped - the actor already knows.
  const assigneeChange = changes.find((change) => change.field === 'assigneeUserId')
  if (assigneeChange?.to && assigneeChange.to !== session.user.id) {
    void notifyUser(assigneeChange.to, {
      type: 'conversation_assigned',
      title: `Conversation #${existing.displayId} was assigned to you`,
      body: existing.subject || undefined,
      link: `/support?conversation=${conversationId}`,
      actorUserId: session.user.id,
      actorName: session.user.name,
    })
  }

  return createSuccessResponse({ conversation: updated, changed: true })
})
