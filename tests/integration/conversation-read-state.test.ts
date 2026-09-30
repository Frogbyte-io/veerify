import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { contact, conversation, conversationReadState, supportInbox } from '../../server/database/schema/support'
import {
  isConversationUnread,
  reMarkConversationUnreadForIncoming,
  setConversationReadState,
  setConversationReadStateInTransaction,
} from '../../server/utils/conversation-read-state'

const suffix = randomUUID()
const orgId = `read_org_${suffix}`
const teamId = `read_team_${suffix}`
const inboxId = `read_inbox_${suffix}`
const agentAId = `read_agent_a_${suffix}`
const agentBId = `read_agent_b_${suffix}`
const contactId = `read_contact_${suffix}`
const conversationId = `read_conversation_${suffix}`
const createdAt = new Date('2026-09-07T08:00:00.000Z')
const firstIncomingAt = new Date('2026-09-07T09:00:00.000Z')

async function snapshot(userId: string) {
  const [row] = await db
    .select({
      assigneeUserId: conversation.assigneeUserId,
      createdAt: conversation.createdAt,
      lastCustomerReplyAt: conversation.lastCustomerReplyAt,
      lastAgentReplyAt: conversation.lastAgentReplyAt,
      lastReadAt: conversationReadState.lastReadAt,
    })
    .from(conversation)
    .leftJoin(
      conversationReadState,
      and(eq(conversationReadState.conversationId, conversation.id), eq(conversationReadState.userId, userId))
    )
    .where(eq(conversation.id, conversationId))

  return row
}

describe('conversation read state (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({
      id: orgId,
      name: 'Read State Org',
      slug: `read-state-org-${suffix}`,
      createdAt,
      updatedAt: createdAt,
    })
    await db.insert(team).values({
      id: teamId,
      name: 'Read State Team',
      slug: `read-state-team-${suffix}`,
      organizationId: orgId,
      createdAt,
      updatedAt: createdAt,
    })
    await db.insert(user).values([
      {
        id: agentAId,
        name: 'Agent A',
        email: `read-agent-a-${suffix}@example.com`,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: agentBId,
        name: 'Agent B',
        email: `read-agent-b-${suffix}@example.com`,
        createdAt,
        updatedAt: createdAt,
      },
    ])
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: 'Read State Inbox',
      slug: `read-state-inbox-${suffix}`,
      createdAt,
      updatedAt: createdAt,
    })
    await db.insert(contact).values({
      id: contactId,
      teamId,
      name: 'Customer',
      email: `read-customer-${suffix}@example.com`,
      createdAt,
      updatedAt: createdAt,
    })
    await db.insert(conversation).values({
      id: conversationId,
      inboxId,
      teamId,
      contactId,
      displayId: 9952,
      subject: 'Read state',
      status: 'open',
      lastActivityAt: firstIncomingAt,
      lastCustomerReplyAt: firstIncomingAt,
      createdAt,
      updatedAt: createdAt,
    })
  })

  afterAll(async () => {
    await db.delete(conversation).where(eq(conversation.id, conversationId))
    await db.delete(contact).where(eq(contact.id, contactId))
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    await db.delete(team).where(eq(team.id, teamId))
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(user).where(inArray(user.id, [agentAId, agentBId]))
  })

  beforeEach(async () => {
    await db.delete(conversationReadState).where(eq(conversationReadState.conversationId, conversationId))
    await db
      .update(conversation)
      .set({
        assigneeUserId: null,
        lastAgentReplyAt: null,
        lastCustomerReplyAt: firstIncomingAt,
        updatedAt: createdAt,
      })
      .where(eq(conversation.id, conversationId))
  })

  it('stores a per-user cursor and a later incoming reply makes an unclaimed conversation unread for everyone', async () => {
    await setConversationReadState(conversationId, agentAId, false, new Date('2026-09-07T10:00:00.000Z'))
    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(false)

    await db
      .update(conversation)
      .set({ lastCustomerReplyAt: new Date('2026-09-07T11:00:00.000Z') })
      .where(eq(conversation.id, conversationId))

    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
    expect(isConversationUnread(await snapshot(agentBId), agentBId)).toBe(true)
  })

  it('records the actual future-dated customer signal that was read without regressing a newer cursor', async () => {
    const futureSignalAt = new Date('2040-01-01T12:00:00.000Z')
    const olderSignalAt = new Date('2040-01-01T11:00:00.000Z')

    await db
      .update(conversation)
      .set({ lastCustomerReplyAt: futureSignalAt })
      .where(eq(conversation.id, conversationId))

    await setConversationReadState(conversationId, agentAId, false)
    expect((await snapshot(agentAId)).lastReadAt).toEqual(futureSignalAt)

    await db.update(conversation).set({ lastCustomerReplyAt: olderSignalAt }).where(eq(conversation.id, conversationId))

    await setConversationReadState(conversationId, agentAId, false)
    expect((await snapshot(agentAId)).lastReadAt).toEqual(futureSignalAt)
  })

  it('does not advance a read cursor past the customer signal observed before inbound completed', async () => {
    const laterIncomingAt = new Date('2026-09-07T11:00:00.000Z')

    await db
      .update(conversation)
      .set({ lastCustomerReplyAt: laterIncomingAt })
      .where(eq(conversation.id, conversationId))

    await setConversationReadState(conversationId, agentAId, false, firstIncomingAt)

    expect((await snapshot(agentAId)).lastReadAt).toEqual(firstIncomingAt)
    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
  })

  it('suppresses handled unread state for everyone except the owner after a customer reply', async () => {
    await db
      .update(conversation)
      .set({
        assigneeUserId: agentAId,
        lastAgentReplyAt: new Date('2026-09-07T10:00:00.000Z'),
        lastCustomerReplyAt: new Date('2026-09-07T11:00:00.000Z'),
      })
      .where(eq(conversation.id, conversationId))

    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
    expect(isConversationUnread(await snapshot(agentBId), agentBId)).toBe(false)
  })

  it('leaves a handled conversation unread only for its assignee after the owner receives a later incoming signal', async () => {
    const handledAt = new Date('2026-09-07T10:00:00.000Z')
    const laterIncomingAt = new Date('2026-09-07T11:00:00.000Z')

    await db
      .update(conversation)
      .set({
        assigneeUserId: agentAId,
        lastAgentReplyAt: handledAt,
        lastCustomerReplyAt: laterIncomingAt,
      })
      .where(eq(conversation.id, conversationId))

    await setConversationReadState(conversationId, agentAId, false, handledAt)
    await setConversationReadState(conversationId, agentBId, false, handledAt)

    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
    expect(isConversationUnread(await snapshot(agentBId), agentBId)).toBe(false)
  })

  it('leaves an owned conversation unread only for its assignee even before that owner sends an outgoing reply', async () => {
    await db
      .update(conversation)
      .set({
        assigneeUserId: agentAId,
        lastAgentReplyAt: null,
        lastCustomerReplyAt: new Date('2026-09-07T11:00:00.000Z'),
      })
      .where(eq(conversation.id, conversationId))

    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
    expect(isConversationUnread(await snapshot(agentBId), agentBId)).toBe(false)
  })

  it('serializes a stale read with inbound invalidation so the new incoming signal remains unread', async () => {
    const laterIncomingAt = new Date('2026-09-07T11:00:00.000Z')
    let releaseReadLock!: () => void
    const readLockReleased = new Promise<void>((resolve) => {
      releaseReadLock = resolve
    })
    let signalObserved!: () => void
    const signalWasObserved = new Promise<void>((resolve) => {
      signalObserved = resolve
    })

    const staleRead = db.transaction(async (tx) => {
      await setConversationReadStateInTransaction(tx, conversationId, agentAId, false, firstIncomingAt)
      signalObserved()
      await readLockReleased
    })

    await signalWasObserved

    const inbound = db.transaction(async (tx) => {
      const [lockedConversation] = await tx
        .select({ assigneeUserId: conversation.assigneeUserId })
        .from(conversation)
        .where(eq(conversation.id, conversationId))
        .for('update')
      await tx
        .update(conversation)
        .set({ lastCustomerReplyAt: laterIncomingAt })
        .where(eq(conversation.id, conversationId))
      await reMarkConversationUnreadForIncoming(tx, conversationId, lockedConversation.assigneeUserId)
    })

    releaseReadLock()
    await Promise.all([staleRead, inbound])

    expect(
      await db.select().from(conversationReadState).where(eq(conversationReadState.conversationId, conversationId))
    ).toEqual([])
    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
  })

  it('implements manual mark-unread by removing the viewer cursor', async () => {
    await setConversationReadState(conversationId, agentAId, false, new Date('2026-09-07T10:00:00.000Z'))
    await setConversationReadState(conversationId, agentAId, true)

    const [stored] = await db
      .select()
      .from(conversationReadState)
      .where(and(eq(conversationReadState.conversationId, conversationId), eq(conversationReadState.userId, agentAId)))
    expect(stored).toBeUndefined()
    expect(isConversationUnread(await snapshot(agentAId), agentAId)).toBe(true)
  })

  it('clears every cursor for an unclaimed incoming message and only the owner cursor once assigned', async () => {
    await setConversationReadState(conversationId, agentAId, false)
    await setConversationReadState(conversationId, agentBId, false)
    await db.transaction((tx) => reMarkConversationUnreadForIncoming(tx, conversationId, null))
    expect(
      await db.select().from(conversationReadState).where(eq(conversationReadState.conversationId, conversationId))
    ).toEqual([])

    await setConversationReadState(conversationId, agentAId, false)
    await setConversationReadState(conversationId, agentBId, false)
    await db.transaction((tx) => reMarkConversationUnreadForIncoming(tx, conversationId, agentAId))
    const remaining = await db
      .select({ userId: conversationReadState.userId })
      .from(conversationReadState)
      .where(eq(conversationReadState.conversationId, conversationId))
    expect(remaining).toEqual([{ userId: agentBId }])
  })
})
