import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { conversationMessage } from '~/server/database/schema/support'
import { user } from '~/server/database/schema/auth'
import { project } from '~/server/database/schema/feedback'

/**
 * Activity messages for the Chatwoot-style inline event feed (`design.md` →
 * Stage 02 → API → "Activity messages"). `kind: 'activity'` rows live in the
 * same `conversationMessage` table as replies and notes, ordered by
 * `createdAt` alongside them - there is deliberately no separate audit table.
 *
 * `isPrivate: true` on every row here: "assigned to Bob" / "status →
 * resolved" is operational detail, not something a future customer-facing
 * view (Stage 10's portal) should show. Not specified in `design.md`; this is
 * the conservative reading, flagged for confirmation like the SUP-02-1 tag
 * columns.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface ConversationChange {
  field: 'status' | 'priority' | 'assigneeUserId' | 'projectId'
  from: string | null
  to: string | null
}

/**
 * Fields whose change is worth an inline activity entry. `subject` is
 * deliberately absent: it is updatable, but renaming a ticket is not an
 * operational event the thread should narrate.
 */
const TRACKED_FIELDS = ['status', 'priority', 'assigneeUserId', 'projectId'] as const

export interface ConversationPatch {
  status?: string
  priority?: string | null
  assigneeUserId?: string | null
  subject?: string | null
  projectId?: string | null
}

interface ConversationState {
  status?: string | null
  priority?: string | null
  assigneeUserId?: string | null
  subject?: string | null
  projectId?: string | null
}

export interface ConversationPatchDiff {
  changes: ConversationChange[]
  updates: Record<string, unknown>
}

/**
 * Work out what a PATCH actually changes. Pure, so the semantics below are
 * unit-testable without a database:
 *
 * - A field absent from the patch is untouched (absent != null; explicitly
 *   sending null clears the field and *is* a change).
 * - A field present but equal to the current value is not a change - re-sending
 *   the same status must not spam the thread with activity messages that say
 *   nothing happened.
 * - `resolvedAt` is stamped when the conversation reaches a terminal status and
 *   cleared when it is reopened, so a reopened-then-resolved ticket measures
 *   from its second resolution. Stage 06's SLA resolution metric and Stage 08's
 *   CSAT attribution both read it.
 */
export function diffConversationPatch(
  existing: ConversationState,
  patch: ConversationPatch,
  now: Date
): ConversationPatchDiff {
  const changes: ConversationChange[] = []
  const updates: Record<string, unknown> = {}

  for (const field of TRACKED_FIELDS) {
    if (!(field in patch)) continue

    const next = patch[field] ?? null
    const previous = existing[field] ?? null
    if (next === previous) continue

    updates[field] = next
    changes.push({ field, from: previous, to: next })
  }

  if ('subject' in patch && (patch.subject ?? null) !== (existing.subject ?? null)) {
    updates.subject = patch.subject ?? null
  }

  if ('status' in updates) {
    updates.resolvedAt = updates.status === 'resolved' || updates.status === 'closed' ? now : null
  }

  return { changes, updates }
}

async function describeChange(tx: Tx, change: ConversationChange): Promise<string> {
  switch (change.field) {
    case 'status':
      return `Status changed from ${change.from} to ${change.to}.`

    case 'priority':
      if (!change.to) return `Priority cleared.`
      return `Priority set to ${change.to}.`

    case 'assigneeUserId': {
      if (!change.to) return `Unassigned.`
      const [assignee] = await tx.select({ name: user.name }).from(user).where(eq(user.id, change.to)).limit(1)
      return `Assigned to ${assignee?.name ?? change.to}.`
    }

    case 'projectId': {
      if (!change.to) return `Product cleared.`
      const [matchedProject] = await tx
        .select({ name: project.name })
        .from(project)
        .where(eq(project.id, change.to))
        .limit(1)
      return `Product set to ${matchedProject?.name ?? change.to}.`
    }
  }
}

/**
 * Insert one `activity` message per change. Must run inside the same
 * transaction as the conversation update it describes, so the two can never
 * diverge (an update that "succeeds" with no matching activity row, or vice
 * versa).
 */
export async function recordConversationActivity(
  tx: Tx,
  conversationId: string,
  changes: ConversationChange[],
  actorUserId: string
): Promise<void> {
  if (changes.length === 0) return

  const now = new Date()

  for (const change of changes) {
    const body = await describeChange(tx, change)

    await tx.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId,
      kind: 'activity',
      body,
      senderKind: 'system',
      senderUserId: actorUserId,
      isPrivate: true,
      createdAt: now,
    })
  }
}
