import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { contact, conversation, conversationStatusEvent, supportInbox } from '../../server/database/schema/support'
import { recordConversationStatusEvent } from '../../server/utils/conversation-activity'

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
    await db.delete(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, ids.conversation))
    await db.update(conversation).set({ status: 'open' }).where(eq(conversation.id, ids.conversation))

    await expect(
      db.transaction(async (tx) => {
        await tx.update(conversation).set({ status: 'resolved' }).where(eq(conversation.id, ids.conversation))
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
    expect(updated.status).toBe('open')
    expect(events).toEqual([])
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
})
