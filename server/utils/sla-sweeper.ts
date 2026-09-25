import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamMember } from '~/server/database/schema/auth'
import {
  conversation,
  conversationMessage,
  slaBreach,
  slaPolicy,
  supportInboxMember,
} from '~/server/database/schema/support'
import { notifyUser } from './notifications'
import type { SlaMetric } from './sla'

const PRIORITY_RANK: Record<string, number> = { low: 1, normal: 2, high: 3, urgent: 4 }

type Candidate = {
  conversation: typeof conversation.$inferSelect
  policy: typeof slaPolicy.$inferSelect
}

function dueMetrics(row: Candidate, now: Date): SlaMetric[] {
  const { conversation: item } = row
  const metrics: SlaMetric[] = []
  if (item.firstResponseDueAt && item.firstResponseDueAt.getTime() <= now.getTime() && !item.firstResponseAt) {
    metrics.push('first_response')
  }
  if (item.nextResponseDueAt && item.nextResponseDueAt.getTime() <= now.getTime()) {
    metrics.push('next_response')
  }
  if (
    item.resolutionDueAt &&
    item.resolutionDueAt.getTime() <= now.getTime() &&
    item.status !== 'resolved' &&
    item.status !== 'closed'
  ) {
    metrics.push('resolution')
  }
  return metrics
}

function metricLabel(metric: SlaMetric): string {
  return metric.replace('_', ' ')
}

async function supervisorRecipients(row: Candidate): Promise<string[]> {
  const [inboxMembers, teamAdmins] = await Promise.all([
    db
      .select({ userId: supportInboxMember.userId })
      .from(supportInboxMember)
      .where(
        and(
          eq(supportInboxMember.inboxId, row.conversation.inboxId),
          inArray(supportInboxMember.role, ['supervisor', 'admin'])
        )
      ),
    db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, row.conversation.teamId), eq(teamMember.role, 'admin'))),
  ])
  return [...new Set([...inboxMembers, ...teamAdmins].map((member) => member.userId))]
}

async function dispatchEscalation(row: Candidate, metric: SlaMetric): Promise<number> {
  const escalation = row.policy.escalation || {}
  const recipientIds = new Set<string>()
  if (escalation.notifyAssignee && row.conversation.assigneeUserId) {
    recipientIds.add(row.conversation.assigneeUserId)
  }
  if (escalation.notifySupervisor) {
    for (const userId of await supervisorRecipients(row)) recipientIds.add(userId)
  }

  const results = await Promise.allSettled(
    [...recipientIds].map((userId) =>
      notifyUser(userId, {
        type: 'sla_breach',
        title: `SLA breached for conversation #${row.conversation.displayId}`,
        body: `The ${metricLabel(metric)} target was missed.`,
        link: `/support?conversationId=${row.conversation.id}`,
      })
    )
  )
  return results.filter((result) => result.status === 'fulfilled' && result.value !== null).length
}

/** Run one idempotent five-minute breach pass. */
export async function runSlaBreachSweep(input: { now?: Date } = {}) {
  const now = input.now ?? new Date()
  const candidates = (await db
    .select({ conversation, policy: slaPolicy })
    .from(conversation)
    .innerJoin(slaPolicy, eq(conversation.slaPolicyId, slaPolicy.id))
    .where(
      and(
        isNull(conversation.slaPausedAt),
        or(
          and(isNotNull(conversation.firstResponseDueAt), lte(conversation.firstResponseDueAt, now)),
          and(isNotNull(conversation.nextResponseDueAt), lte(conversation.nextResponseDueAt, now)),
          and(isNotNull(conversation.resolutionDueAt), lte(conversation.resolutionDueAt, now))
        )
      )
    )
    .orderBy(asc(conversation.createdAt))
    .limit(500)) as Candidate[]

  let breached = 0
  let notifications = 0
  for (const row of candidates) {
    for (const metric of dueMetrics(row, now)) {
      const created = await db.transaction(async (tx) => {
        const [breach] = await tx
          .insert(slaBreach)
          .values({
            id: randomUUID(),
            conversationId: row.conversation.id,
            metric,
            breachedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning()
        if (!breach) return null

        await tx.insert(conversationMessage).values({
          id: randomUUID(),
          conversationId: row.conversation.id,
          kind: 'activity',
          body: `SLA breached: ${metricLabel(metric)}.`,
          senderKind: 'system',
          senderUserId: null,
          isPrivate: true,
          createdAt: now,
        })

        const raisedPriority = row.policy.escalation?.raisePriority
        if (
          raisedPriority &&
          (PRIORITY_RANK[raisedPriority] ?? 0) > (PRIORITY_RANK[row.conversation.priority ?? ''] ?? 0)
        ) {
          await tx
            .update(conversation)
            .set({ priority: raisedPriority, updatedAt: now })
            .where(eq(conversation.id, row.conversation.id))
        }
        return breach
      })

      if (!created) continue
      breached += 1
      notifications += await dispatchEscalation(row, metric)
      await db
        .update(slaBreach)
        .set({ notifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(slaBreach.id, created.id))
    }
  }

  return { scanned: candidates.length, breached, notifications }
}
