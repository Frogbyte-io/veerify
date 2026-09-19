import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { contact, conversation, conversationMessage, supportInbox } from '../../server/database/schema/support'
import { claimConversationForAgent } from '../../server/utils/conversation-assignment'
import { commitMessageWithAttachments } from '../../server/utils/support-attachment-finalization'

const suffix = randomUUID()
const orgId = `assignment_org_${suffix}`
const teamId = `assignment_team_${suffix}`
const inboxId = `assignment_inbox_${suffix}`
const agentAId = `assignment_agent_a_${suffix}`
const agentBId = `assignment_agent_b_${suffix}`
const contactId = `assignment_contact_${suffix}`
const conversationId = `assignment_conversation_${suffix}`
const now = new Date('2026-09-07T12:00:00.000Z')

function outgoing(messageId: string) {
  return {
    channelMessageId: `${messageId}@example.com`,
    inReplyTo: null,
    referencesForStorage: null,
    deliveryPayload: {
      to: 'customer@example.com',
      subject: 'Re: Ownership',
      text: 'Reply',
    },
  }
}

async function commit(kind: 'outgoing' | 'note', userId: string, messageId = `assignment_message_${randomUUID()}`) {
  const [existingConversation] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
  const outgoingReply = kind === 'outgoing' ? outgoing(messageId) : null

  return commitMessageWithAttachments({
    reservation: [],
    conversationId,
    userId,
    now,
    existingConversation,
    outgoing: outgoingReply,
    message: {
      id: messageId,
      kind,
      body: kind === 'outgoing' ? 'Reply' : 'Internal note',
      bodyHtml: null,
      isPrivate: kind === 'note',
      channelMessageId: outgoingReply?.channelMessageId ?? null,
      inReplyTo: null,
      channelHeaders: null,
      deliveryStatus: kind === 'outgoing' ? 'pending' : 'delivered',
    },
  })
}

describe('conversation assignment while posting messages (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({
      id: orgId,
      name: 'Assignment Org',
      slug: `assignment-org-${suffix}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(team).values({
      id: teamId,
      name: 'Assignment Team',
      slug: `assignment-team-${suffix}`,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(user).values([
      {
        id: agentAId,
        name: 'Agent A',
        email: `assignment-agent-a-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: agentBId,
        name: 'Agent B',
        email: `assignment-agent-b-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: 'Assignment Inbox',
      slug: `assignment-inbox-${suffix}`,
      emailAddress: 'support@example.com',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(contact).values({
      id: contactId,
      teamId,
      name: 'Customer',
      email: 'customer@example.com',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(conversation).values({
      id: conversationId,
      inboxId,
      teamId,
      contactId,
      displayId: 9951,
      subject: 'Ownership',
      status: 'open',
      createdAt: now,
      updatedAt: now,
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
    await db.delete(conversationMessage).where(eq(conversationMessage.conversationId, conversationId))
    await db
      .update(conversation)
      .set({ assigneeUserId: null, firstResponseAt: null, lastAgentReplyAt: null })
      .where(eq(conversation.id, conversationId))
  })

  it('auto-claims an unassigned conversation on an outgoing reply and writes one activity', async () => {
    await commit('outgoing', agentAId)

    const [updated] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    const messages = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, conversationId))
      .orderBy(asc(conversationMessage.createdAt), asc(conversationMessage.id))

    expect(updated.assigneeUserId).toBe(agentAId)
    expect(messages.filter((message) => message.kind === 'activity')).toMatchObject([
      {
        body: 'Assigned to Agent A.',
        senderKind: 'system',
        senderUserId: agentAId,
        isPrivate: true,
      },
    ])
  })

  it('does not claim an unassigned conversation when an internal note is posted', async () => {
    await commit('note', agentAId)

    const [updated] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    const activities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, conversationId))

    expect(updated.assigneeUserId).toBeNull()
    expect(activities.filter((message) => message.kind === 'activity')).toEqual([])
  })

  it('does not steal a conversation already assigned to another agent', async () => {
    await db.update(conversation).set({ assigneeUserId: agentBId }).where(eq(conversation.id, conversationId))

    await commit('outgoing', agentAId)

    const [updated] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    const activities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, conversationId))

    expect(updated.assigneeUserId).toBe(agentBId)
    expect(activities.filter((message) => message.kind === 'activity')).toEqual([])
  })

  it('records only one claim when two agents reply to an unassigned conversation concurrently', async () => {
    const results = await Promise.all([commit('outgoing', agentAId), commit('outgoing', agentBId)])

    const [updated] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    const messages = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, conversationId))

    expect(results).toHaveLength(2)
    expect([agentAId, agentBId]).toContain(updated.assigneeUserId)
    expect(messages.filter((message) => message.kind === 'outgoing')).toHaveLength(2)
    expect(messages.filter((message) => message.kind === 'activity')).toHaveLength(1)
  })

  it('lets only one agent win two concurrent explicit claims', async () => {
    const results = await Promise.all([
      claimConversationForAgent(conversationId, agentAId, now),
      claimConversationForAgent(conversationId, agentBId, now),
    ])

    const [updated] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
    const activities = await db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.conversationId, conversationId))

    const winners = results.filter((result) => result.claimed)
    const losers = results.filter((result) => !result.claimed)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(winners[0].conversation?.assigneeUserId).toBe(updated.assigneeUserId)
    expect(losers[0].conversation?.assigneeUserId).toBe(updated.assigneeUserId)
    expect(activities.filter((message) => message.kind === 'activity')).toMatchObject([
      {
        body: updated.assigneeUserId === agentAId ? 'Assigned to Agent A.' : 'Assigned to Agent B.',
        senderKind: 'system',
        senderUserId: updated.assigneeUserId,
        isPrivate: true,
      },
    ])
  })
})
