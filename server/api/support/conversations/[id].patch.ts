/**
 * @openapi
 * /api/support/conversations/{id}:
 *   patch:
 *     tags: [Support]
 *     summary: Update a conversation's status, priority, assignee, subject, or folder
 *     description: >
 *       Every status, priority, assignee, and folder change also writes an
 *       `activity` message into the thread, in the same transaction as the
 *       update. Subject changes deliberately do not - they are not an
 *       operational event worth an inline feed entry.
 *
 *       Archive is `status: closed` (labelled Archived in the UI). Spam and
 *       Trash are folders, not statuses: `spam: true` sets `spamAt`, `spam: false`
 *       clears it; `deleted: true` sets `deletedAt` (the conversation is purged
 *       permanently after 30 days), `deleted: false` restores it. A conversation
 *       keeps its status while in a folder, and re-sending the current state is
 *       a no-op. Permissions are the same as for status changes: any member of
 *       the conversation's inbox who can work conversations (agent, supervisor,
 *       admin) or a project admin.
 *     operationId: updateSupportConversation
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [open, pending, resolved, snoozed, closed] }
 *               priority: { type: string, enum: [low, normal, high, urgent], nullable: true }
 *               assigneeUserId: { type: string, nullable: true }
 *               subject: { type: string, maxLength: 500, nullable: true }
 *               spam: { type: boolean, description: Move to Spam (true) or back out of it (false) }
 *               deleted: { type: boolean, description: Move to Trash (true) or restore (false) }
 *     responses:
 *       200: { description: Conversation updated }
 *       400: { description: assigneeUserId does not belong to this project }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import {
  diffConversationPatch,
  recordConversationActivity,
  recordConversationStatusEvent,
} from '~/server/utils/conversation-activity'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { notifyUser } from '~/server/utils/notifications'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, conversation, conversationTag } from '~/server/database/schema/support'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'
import { helpdeskAppliesTo } from '~/server/utils/conversation-behaviour'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { diffFolderPatch, recordFolderActivity } from '~/server/utils/support-trash'

const bodySchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  subject: z.string().trim().max(500).nullable().optional(),
  spam: z.boolean().optional(),
  deleted: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // A foreign key proves the user and project exist, not that they belong to
  // this conversation's project - same cross-tenant gap Stage 01 closed for
  // contacts and companies.
  if (body.assigneeUserId) {
    if (!(await hasProjectAccess(existing.projectId, body.assigneeUserId))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Assignee is not a member of this project'),
      })
    }
  }

  const now = new Date()
  const { changes, updates: fieldUpdates } = diffConversationPatch(existing, body, now)
  const { changes: folderChanges, updates: folderUpdates } = diffFolderPatch(existing, body, now)
  const updates = { ...fieldUpdates, ...folderUpdates }

  if (Object.keys(updates).length === 0) {
    return createSuccessResponse({ conversation: existing, changed: false })
  }

  // Behaviour and folders after this patch, which decide whether an SLA applies.
  const nextState = {
    behaviour: existing.behaviour,
    spamAt: 'spamAt' in updates ? (updates.spamAt as Date | null) : existing.spamAt,
    deletedAt: 'deletedAt' in updates ? (updates.deletedAt as Date | null) : existing.deletedAt,
  }
  // Provider spam is created without an SLA. Taking a conversation out of Spam
  // (or Trash) without one assigns it now.
  const assignSlaOnRestore =
    folderChanges.some((change) => !change.to) && !existing.slaPolicyId && helpdeskAppliesTo(nextState)
  const recomputeSla = updates.priority !== undefined || assignSlaOnRestore

  let sla: Awaited<ReturnType<typeof resolveSlaAssignment>> | null | undefined
  if (recomputeSla) {
    const nextPriority = (updates.priority !== undefined ? updates.priority : existing.priority) as string | null
    const [contactRow] = await db
      .select({ companyId: contact.companyId })
      .from(contact)
      .where(eq(contact.id, existing.contactId))
      .limit(1)
    const tags = await db
      .select({ tagId: conversationTag.tagId })
      .from(conversationTag)
      .where(eq(conversationTag.conversationId, existing.id))
    sla = await resolveSlaAssignment({
      projectId: existing.projectId,
      inboxId: existing.inboxId,
      priority: nextPriority,
      companyId: contactRow?.companyId,
      tagIds: tags.map((tag) => tag.tagId),
      start: now,
      includeNextResponse: assignSlaOnRestore ? Boolean(existing.firstResponseAt) : undefined,
      conversation: nextState,
    })
  }

  const updated = await db.transaction(async (tx) => {
    const slaPause = updates.status === 'pending' && existing.status !== 'pending' ? { slaPausedAt: now } : {}
    const [row] = await tx
      .update(conversation)
      .set({
        ...updates,
        ...slaPause,
        ...(recomputeSla
          ? (sla ?? { slaPolicyId: null, firstResponseDueAt: null, nextResponseDueAt: null, resolutionDueAt: null })
          : {}),
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(conversation.id, conversationId))
      .returning()

    // Same transaction as the update it describes, so the two can never
    // diverge.
    await recordConversationActivity(tx, conversationId, changes, session.user.id)
    await recordFolderActivity(tx, conversationId, folderChanges, session.user.id)

    const statusChange = changes.find((change) => change.field === 'status')
    if (statusChange) {
      await recordConversationStatusEvent(tx, {
        projectId: existing.projectId,
        inboxId: existing.inboxId,
        conversationId,
        fromStatus: statusChange.from,
        toStatus: statusChange.to as string,
        actorUserId: session.user.id,
        occurredAt: now,
      })
    }

    return row
  })

  await publishConversationEvent({
    type: 'conversation.updated',
    projectId: existing.projectId,
    inboxId: existing.inboxId,
    conversationId,
  })
  await triggerAutomationEvent({
    conversationId,
    trigger: 'conversation_updated',
    actorUserId: session.user.id,
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
      // Matches the query key `/inbox` writes when a conversation is
      // selected, so the link round-trips with the page's own URL sync.
      link: `/inbox?conversationId=${conversationId}`,
      actorUserId: session.user.id,
      actorName: session.user.name,
    })
  }

  return createSuccessResponse({ conversation: updated, changed: true })
})
