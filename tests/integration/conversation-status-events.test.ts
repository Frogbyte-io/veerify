import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import {
  automationRule,
  contact,
  conversation,
  conversationMessage,
  conversationStatusEvent,
  supportInbox,
} from '../../server/database/schema/support'
import {
  applyConversationStatusTransition,
  diffConversationPatch,
  recordConversationActivity,
  recordConversationStatusEvent,
} from '../../server/utils/conversation-activity'
import { updatesForInboundReply } from '../../server/utils/inbound-threading'
import { runAutomationRules } from '../../server/utils/automation-engine'

const suffix = randomUUID()
const ids = {
  organization: `status_event_org_${suffix}`,
  team: `status_event_team_${suffix}`,
  inbox: `status_event_inbox_${suffix}`,
  user: `status_event_user_${suffix}`,
  contact: `status_event_contact_${suffix}`,
  conversation: `status_event_conversation_${suffix}`,
}
const now = new Date('2026-09-18T12:00:00.000Z')

describe('conversation status events (real Postgres)', () => {
  beforeAll(async () => {
    await db
      .insert(organization)
      .values({ id: ids.organization, name: 'Status events', slug: `status-events-${suffix}` })
    await db.insert(team).values({
      id: ids.team,
      name: 'Status events team',
      slug: `status-events-${suffix}`,
      organizationId: ids.organization,
    })
    await db.insert(user).values({
      id: ids.user,
      name: 'Status Actor',
      email: `status-events-${suffix}@example.com`,
    })
    await db.insert(supportInbox).values({
      id: ids.inbox,
      teamId: ids.team,
      name: 'Status Inbox',
      slug: `status-events-${suffix}`,
    })
    await db.insert(contact).values({ id: ids.contact, teamId: ids.team, name: 'Customer' })
    await db.insert(conversation).values({
      id: ids.conversation,
      teamId: ids.team,
      inboxId: ids.inbox,
      contactId: ids.contact,
      displayId: 9917,
      status: 'open',
    })
  })

  afterAll(async () => {
    await db.delete(conversation).where(eq(conversation.id, ids.conversation))
    await db.delete(contact).where(eq(contact.id, ids.contact))
    await db.delete(supportInbox).where(eq(supportInbox.id, ids.inbox))
    await db.delete(user).where(eq(user.id, ids.user))
    await db.delete(team).where(eq(team.id, ids.team))
    await db.delete(organization).where(eq(organization.id, ids.organization))
  })

  async function applyPatchStatus(status: 'open' | 'resolved') {
    const [existing] = await db.select().from(conversation).where(eq(conversation.id, ids.conversation))
    const now = new Date('2026-09-18T12:00:03.000Z')
    const { changes, updates } = diffConversationPatch(existing, { status }, now)
    if (Object.keys(updates).length === 0) return false

    await db.transaction(async (tx) => {
      await tx
        .update(conversation)
        .set({ ...updates, updatedAt: now })
        .where(eq(conversation.id, ids.conversation))
      await recordConversationActivity(tx as any, ids.conversation, changes, ids.user)
      const statusChange = changes.find((change) => change.field === 'status')
      if (statusChange) {
        await recordConversationStatusEvent(tx as any, {
          teamId: ids.team,
          inboxId: ids.inbox,
          conversationId: ids.conversation,
          fromStatus: statusChange.from,
          toStatus: statusChange.to as string,
          actorUserId: ids.user,
          occurredAt: now,
        })
      }
    })
    return true
  }

  it('keeps a no-op PATCH status change event-free and records one event for a real change', async () => {
    await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await db.update(conversation).set({ status: 'open' }).where(eq(conversation.id, ids.conversation))

    expect(await applyPatchStatus('open')).toBe(false)
    expect(
      await db
        .select()
        .from(conversationStatusEvent)
        .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    ).toEqual([])

    expect(await applyPatchStatus('resolved')).toBe(true)
    const events = await db
      .select()
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    const activities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, ids.conversation))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ fromStatus: 'open', toStatus: 'resolved', teamId: ids.team, inboxId: ids.inbox })
    expect(activities.filter((message) => message.kind === 'activity')).toHaveLength(1)
  })

  it('stores ordered transitions with denormalized tenant and inbox attribution', async () => {
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))

    await recordConversationStatusEvent(db as any, {
      teamId: ids.team,
      inboxId: ids.inbox,
      conversationId: ids.conversation,
      fromStatus: null,
      toStatus: 'open',
      actorUserId: ids.user,
      occurredAt: new Date('2026-09-18T12:00:01.000Z'),
    })
    await recordConversationStatusEvent(db as any, {
      teamId: ids.team,
      inboxId: ids.inbox,
      conversationId: ids.conversation,
      fromStatus: 'open',
      toStatus: 'resolved',
      actorUserId: ids.user,
      occurredAt: new Date('2026-09-18T12:00:02.000Z'),
    })

    const events = await db
      .select()
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
      .orderBy(asc(conversationStatusEvent.occurredAt))

    expect(events).toHaveLength(2)
    expect(events.map((event) => event.toStatus)).toEqual(['open', 'resolved'])
    expect(events[1]).toMatchObject({ teamId: ids.team, inboxId: ids.inbox, actorUserId: ids.user })
  })

  it('rolls back a status update and event together', async () => {
    await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await db.update(conversation).set({ status: 'open' }).where(eq(conversation.id, ids.conversation))

    await expect(
      db.transaction(async (tx) => {
        await tx.update(conversation).set({ status: 'resolved' }).where(eq(conversation.id, ids.conversation))
        await recordConversationActivity(
          tx as any,
          ids.conversation,
          [{ field: 'status', from: 'open', to: 'resolved' }],
          ids.user
        )
        await recordConversationStatusEvent(tx as any, {
          teamId: ids.team,
          inboxId: ids.inbox,
          conversationId: ids.conversation,
          fromStatus: 'open',
          toStatus: 'resolved',
          actorUserId: ids.user,
          occurredAt: now,
        })
        throw new Error('rollback status event')
      })
    ).rejects.toThrow('rollback status event')

    const [updated] = await db
      .select({ status: conversation.status })
      .from(conversation)
      .where(eq(conversation.id, ids.conversation))
    const events = await db
      .select()
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    const activities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, ids.conversation))
    expect(updated.status).toBe('open')
    expect(events).toEqual([])
    expect(activities).toEqual([])
  })

  it('enforces supported statuses and the reporting indexes', async () => {
    await expect(
      db.insert(conversationStatusEvent).values({
        id: randomUUID(),
        teamId: ids.team,
        inboxId: ids.inbox,
        conversationId: ids.conversation,
        fromStatus: 'invalid',
        toStatus: 'open',
        actorUserId: null,
        occurredAt: now,
      })
    ).rejects.toThrow()

    const indexes = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'conversation_status_event'
    `)
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'conversation_status_event_team_occurred_at_idx',
        'conversation_status_event_conversation_occurred_at_idx',
      ])
    )
  })

  it('records inbound pending/resolved reopens with no actor and never records creation', async () => {
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    expect(
      await db
        .select()
        .from(conversationStatusEvent)
        .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    ).toEqual([])

    for (const [fromStatus, receivedAt] of [
      ['pending', new Date('2026-09-18T12:01:00.000Z')],
      ['resolved', new Date('2026-09-18T12:02:00.000Z')],
    ] as const) {
      await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
      await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
      await db
        .update(conversation)
        .set({ status: fromStatus, resolvedAt: fromStatus === 'resolved' ? now : null })
        .where(eq(conversation.id, ids.conversation))

      await db.transaction(async (tx) => {
        const updates = updatesForInboundReply({ status: fromStatus }, receivedAt, receivedAt)
        await tx.update(conversation).set(updates).where(eq(conversation.id, ids.conversation))
        await recordConversationActivity(
          tx as any,
          ids.conversation,
          [{ field: 'status', from: fromStatus, to: 'open' }],
          null
        )
        await recordConversationStatusEvent(tx as any, {
          teamId: ids.team,
          inboxId: ids.inbox,
          conversationId: ids.conversation,
          fromStatus,
          toStatus: 'open',
          actorUserId: null,
          occurredAt: receivedAt,
        })
      })

      const [updated] = await db
        .select({ status: conversation.status, resolvedAt: conversation.resolvedAt })
        .from(conversation)
        .where(eq(conversation.id, ids.conversation))
      const [event] = await db
        .select()
        .from(conversationStatusEvent)
        .where(eq(conversationStatusEvent.conversationId, ids.conversation))
      expect(updated).toMatchObject({ status: 'open', resolvedAt: null })
      expect(event).toMatchObject({ fromStatus, toStatus: 'open', actorUserId: null })
    }
  })

  it('makes automation set_status atomic, attributed, resolvedAt-aware, and event-free on no-op', async () => {
    const ruleId = `status_event_automation_rule_${suffix}`
    await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await db.delete(automationRule).where(eq(automationRule.id, ruleId))
    await db.update(conversation).set({ status: 'open', resolvedAt: null }).where(eq(conversation.id, ids.conversation))
    await db.insert(automationRule).values({
      id: ruleId,
      teamId: ids.team,
      inboxId: ids.inbox,
      name: 'Automation status event',
      trigger: 'conversation_created',
      conditions: {},
      actions: [{ type: 'set_status', status: 'resolved' }],
      createdAt: now,
      updatedAt: now,
    })

    const first = await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'conversation_created',
      actorUserId: ids.user,
    })
    const [updated] = await db
      .select({ status: conversation.status, resolvedAt: conversation.resolvedAt })
      .from(conversation)
      .where(eq(conversation.id, ids.conversation))
    const firstEvents = await db
      .select()
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    const firstActivities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, ids.conversation))

    expect(first.evaluations.find((evaluation) => evaluation.ruleId === ruleId)?.status).toBe('applied')
    expect(updated?.status).toBe('resolved')
    expect(updated?.resolvedAt).toBeInstanceOf(Date)
    expect(firstEvents).toHaveLength(1)
    expect(firstEvents[0]).toMatchObject({ fromStatus: 'open', toStatus: 'resolved', actorUserId: ids.user })
    expect(firstActivities.filter((message) => message.kind === 'activity')).toHaveLength(1)

    await runAutomationRules({
      conversationId: ids.conversation,
      trigger: 'conversation_created',
      actorUserId: ids.user,
    })
    const secondEvents = await db
      .select()
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    const secondActivities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, ids.conversation))
    expect(secondEvents).toHaveLength(1)
    expect(secondActivities.filter((message) => message.kind === 'activity')).toHaveLength(1)
  })

  it('rolls back automation status, activity, event, and resolvedAt together', async () => {
    await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await db.update(conversation).set({ status: 'open', resolvedAt: null }).where(eq(conversation.id, ids.conversation))

    await expect(
      db.transaction(async (tx) => {
        await applyConversationStatusTransition(tx as any, {
          conversationId: ids.conversation,
          teamId: ids.team,
          inboxId: ids.inbox,
          toStatus: 'resolved',
          actorUserId: ids.user,
          occurredAt: now,
        })
        throw new Error('rollback automation status event')
      })
    ).rejects.toThrow('rollback automation status event')

    const [updated] = await db
      .select({ status: conversation.status, resolvedAt: conversation.resolvedAt })
      .from(conversation)
      .where(eq(conversation.id, ids.conversation))
    expect(updated).toMatchObject({ status: 'open', resolvedAt: null })
    expect(
      await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, ids.conversation))
    ).toEqual([])
    expect(
      await db
        .select()
        .from(conversationStatusEvent)
        .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    ).toEqual([])
  })

  it('preserves the status event and nulls its actor when the user is deleted', async () => {
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await recordConversationStatusEvent(db as any, {
      teamId: ids.team,
      inboxId: ids.inbox,
      conversationId: ids.conversation,
      fromStatus: 'open',
      toStatus: 'pending',
      actorUserId: ids.user,
      occurredAt: now,
    })

    await db.delete(user).where(eq(user.id, ids.user))
    const [event] = await db
      .select({ actorUserId: conversationStatusEvent.actorUserId })
      .from(conversationStatusEvent)
      .where(eq(conversationStatusEvent.conversationId, ids.conversation))
    expect(event?.actorUserId).toBeNull()
  })
})
