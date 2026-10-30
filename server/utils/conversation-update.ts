/**
 * Changing a conversation (status, priority, assignee, subject, folder, type),
 * shared by `PATCH /api/support/conversations/[id]` and the reply route, which
 * can switch the type before a reply is committed and resolve the conversation
 * after it.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { contact, conversation, conversationTag } from '~/server/database/schema/support'
import {
  diffConversationPatch,
  recordConversationActivity,
  recordConversationStatusEvent,
  type ConversationChange,
  type ConversationPatch,
} from '~/server/utils/conversation-activity'
import { helpdeskAppliesTo } from '~/server/utils/conversation-behaviour'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { notifyUser } from '~/server/utils/notifications'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { diffFolderPatch, recordFolderActivity, type FolderPatch } from '~/server/utils/support-trash'

export type ConversationRow = typeof conversation.$inferSelect
export type ConversationBehaviour = 'mail' | 'helpdesk'

export type ConversationUpdatePatch = ConversationPatch & FolderPatch

const NO_SLA = { slaPolicyId: null, firstResponseDueAt: null, nextResponseDueAt: null, resolutionDueAt: null }

interface NextConversationState {
  priority: string | null
  behaviour: string
  spamAt: Date | null
  deletedAt: Date | null
}

/** The SLA columns for the conversation as it will be: the matching policy's deadlines, or none. */
async function resolveSlaColumns(
  existing: ConversationRow,
  next: NextConversationState,
  now: Date,
  includeNextResponse?: boolean
) {
  const [contactRow] = await db
    .select({ companyId: contact.companyId })
    .from(contact)
    .where(eq(contact.id, existing.contactId))
    .limit(1)
  const tags = await db
    .select({ tagId: conversationTag.tagId })
    .from(conversationTag)
    .where(eq(conversationTag.conversationId, existing.id))
  const sla = await resolveSlaAssignment({
    projectId: existing.projectId,
    inboxId: existing.inboxId,
    priority: next.priority,
    companyId: contactRow?.companyId,
    tagIds: tags.map((tag) => tag.tagId),
    start: now,
    includeNextResponse,
    conversation: { behaviour: next.behaviour, spamAt: next.spamAt, deletedAt: next.deletedAt },
  })
  return sla ?? NO_SLA
}

/**
 * The column changes of turning a conversation into plain mail or a support
 * case. A support case gets the SLA that applies to it now; plain mail drops
 * every SLA field. `displayId` (the case number) never changes, so switching
 * back to mail and again to a case keeps the same number.
 */
async function behaviourSwitchColumns(
  existing: ConversationRow,
  to: ConversationBehaviour,
  next: Omit<NextConversationState, 'behaviour'> & { status: string },
  now: Date
) {
  if (to === 'mail') return { ...NO_SLA, slaPausedAt: null }
  const columns = await resolveSlaColumns(existing, { ...next, behaviour: to }, now, Boolean(existing.firstResponseAt))
  // A pending conversation has its SLA clock paused until the customer replies.
  return next.status === 'pending' && !existing.slaPausedAt ? { ...columns, slaPausedAt: now } : columns
}

export interface BehaviourSwitchPlan {
  updates: Record<string, unknown>
  changes: ConversationChange[]
}

/**
 * What switching the conversation's type changes, or null when it already has
 * that type. Computed before a transaction; apply it with
 * `applyBehaviourSwitch` inside one.
 */
export async function planBehaviourSwitch(
  existing: ConversationRow,
  to: ConversationBehaviour,
  now: Date
): Promise<BehaviourSwitchPlan | null> {
  const { changes, updates } = diffConversationPatch(existing, { behaviour: to }, now)
  if (changes.length === 0) return null
  const columns = await behaviourSwitchColumns(
    existing,
    to,
    { priority: existing.priority, status: existing.status, spamAt: existing.spamAt, deletedAt: existing.deletedAt },
    now
  )
  return { updates: { ...updates, ...columns }, changes }
}

/** Write a planned type switch and its activity message, in the caller's transaction. */
export async function applyBehaviourSwitch(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  existing: ConversationRow,
  plan: BehaviourSwitchPlan,
  actorUserId: string,
  now: Date
): Promise<void> {
  await tx
    .update(conversation)
    .set({ ...plan.updates, lastActivityAt: now, updatedAt: now })
    .where(eq(conversation.id, existing.id))
  await recordConversationActivity(tx, existing.id, plan.changes, actorUserId)
}

/** Realtime and automation events for a conversation that just changed. */
export async function announceConversationUpdated(existing: ConversationRow, actorUserId: string): Promise<void> {
  await publishConversationEvent({
    type: 'conversation.updated',
    projectId: existing.projectId,
    inboxId: existing.inboxId,
    conversationId: existing.id,
  })
  await triggerAutomationEvent({
    conversationId: existing.id,
    trigger: 'conversation_updated',
    actorUserId,
  })
}

/**
 * Apply a status/priority/assignee/subject/folder/type patch to a conversation:
 * the update, its activity messages and status event in one transaction, then
 * the realtime event, automation trigger and assignee notification. The caller
 * has already checked access and that a new assignee belongs to the project.
 */
export async function updateConversation(input: {
  existing: ConversationRow
  patch: ConversationUpdatePatch
  actor: { id: string; name?: string | null }
}): Promise<{ conversation: ConversationRow; changed: boolean }> {
  const { existing, patch, actor } = input
  const conversationId = existing.id

  const now = new Date()
  const { changes, updates: fieldUpdates } = diffConversationPatch(existing, patch, now)
  const { changes: folderChanges, updates: folderUpdates } = diffFolderPatch(existing, patch, now)
  const updates = { ...fieldUpdates, ...folderUpdates }

  if (Object.keys(updates).length === 0) {
    return { conversation: existing, changed: false }
  }

  // Behaviour and folders after this patch, which decide whether an SLA applies.
  const behaviourChange = changes.find((change) => change.field === 'behaviour')
  const nextState = {
    behaviour: (updates.behaviour as string | undefined) ?? existing.behaviour,
    spamAt: 'spamAt' in updates ? (updates.spamAt as Date | null) : existing.spamAt,
    deletedAt: 'deletedAt' in updates ? (updates.deletedAt as Date | null) : existing.deletedAt,
  }
  const nextPriority = (updates.priority !== undefined ? updates.priority : existing.priority) as string | null
  // Provider spam is created without an SLA. Taking a conversation out of Spam
  // (or Trash) without one assigns it now.
  const assignSlaOnRestore =
    folderChanges.some((change) => !change.to) && !existing.slaPolicyId && helpdeskAppliesTo(nextState)
  const recomputeSla = updates.priority !== undefined || assignSlaOnRestore

  let slaColumns: Record<string, unknown> = {}
  if (behaviourChange) {
    slaColumns = await behaviourSwitchColumns(
      existing,
      behaviourChange.to as ConversationBehaviour,
      {
        priority: nextPriority,
        status: (updates.status as string | undefined) ?? existing.status,
        spamAt: nextState.spamAt,
        deletedAt: nextState.deletedAt,
      },
      now
    )
  } else if (recomputeSla) {
    slaColumns = await resolveSlaColumns(
      existing,
      { priority: nextPriority, ...nextState },
      now,
      assignSlaOnRestore ? Boolean(existing.firstResponseAt) : undefined
    )
  }

  const updated = await db.transaction(async (tx) => {
    const slaPause = updates.status === 'pending' && existing.status !== 'pending' ? { slaPausedAt: now } : {}
    const [row] = await tx
      .update(conversation)
      .set({
        ...updates,
        ...slaColumns,
        ...slaPause,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(conversation.id, conversationId))
      .returning()

    // Same transaction as the update it describes, so the two can never
    // diverge.
    await recordConversationActivity(tx, conversationId, changes, actor.id)
    await recordFolderActivity(tx, conversationId, folderChanges, actor.id)

    const statusChange = changes.find((change) => change.field === 'status')
    if (statusChange) {
      await recordConversationStatusEvent(tx, {
        projectId: existing.projectId,
        inboxId: existing.inboxId,
        conversationId,
        fromStatus: statusChange.from,
        toStatus: statusChange.to as string,
        actorUserId: actor.id,
        occurredAt: now,
      })
    }

    return row
  })

  await announceConversationUpdated(existing, actor.id)

  // Tell the new assignee they now own this ticket. Fire-and-forget: a
  // notification failure must not turn a successful update into a failed
  // request, and `notifyUser` swallows its own errors. Self-assignment is
  // skipped - the actor already knows.
  const assigneeChange = changes.find((change) => change.field === 'assigneeUserId')
  if (assigneeChange?.to && assigneeChange.to !== actor.id) {
    void notifyUser(assigneeChange.to, {
      type: 'conversation_assigned',
      title: `Conversation #${existing.displayId} was assigned to you`,
      body: existing.subject || undefined,
      // Matches the query key `/inbox` writes when a conversation is
      // selected, so the link round-trips with the page's own URL sync.
      link: `/inbox?conversationId=${conversationId}`,
      actorUserId: actor.id,
      actorName: actor.name ?? undefined,
    })
  }

  return { conversation: updated, changed: true }
}
