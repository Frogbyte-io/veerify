import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, teamMember, user } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationMessage,
  csatResponse,
  csatSurvey,
  supportInbox,
  supportOutboundDelivery,
} from '../../server/database/schema/support'
import { runCsatDispatchSweep } from '../../server/utils/csat'

const now = new Date('2026-01-15T12:00:00.000Z')
const ids = {
  org: `csat_org_${randomUUID()}`,
  team: `csat_team_${randomUUID()}`,
  user: `csat_user_${randomUUID()}`,
  inbox: `csat_inbox_${randomUUID()}`,
  contact: `csat_contact_${randomUUID()}`,
  noReplyContact: `csat_no_reply_contact_${randomUUID()}`,
  optedOutContact: `csat_opted_out_contact_${randomUUID()}`,
  conversation: `csat_conversation_${randomUUID()}`,
  noReplyConversation: `csat_no_reply_conversation_${randomUUID()}`,
  optedOutConversation: `csat_opted_out_conversation_${randomUUID()}`,
  survey: `csat_survey_${randomUUID()}`,
  reply: `csat_reply_${randomUUID()}`,
}

beforeAll(async () => {
  await db.insert(organization).values({
    id: ids.org,
    name: 'CSAT test org',
    slug: `csat-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(team).values({
    id: ids.team,
    name: 'CSAT test team',
    slug: `csat-team-${randomUUID()}`,
    organizationId: ids.org,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(user).values({
    id: ids.user,
    name: 'CSAT agent',
    email: `csat-agent-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(teamMember).values({
    id: `csat_member_${randomUUID()}`,
    teamId: ids.team,
    userId: ids.user,
    role: 'member',
    createdAt: now,
  })
  await db.insert(supportInbox).values({
    id: ids.inbox,
    teamId: ids.team,
    name: 'CSAT inbox',
    slug: `csat-inbox-${randomUUID()}`,
    emailAddress: `support-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(contact).values([
    {
      id: ids.contact,
      teamId: ids.team,
      name: 'Survey Customer',
      email: `survey-customer-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.noReplyContact,
      teamId: ids.team,
      name: 'No Reply Customer',
      email: `no-reply-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ids.optedOutContact,
      teamId: ids.team,
      name: 'Opted Out Customer',
      email: `opted-out-${randomUUID()}@example.com`,
      attributes: { csatOptOut: true },
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(conversation).values([
    {
      id: ids.conversation,
      inboxId: ids.inbox,
      teamId: ids.team,
      contactId: ids.contact,
      displayId: 1,
      status: 'resolved',
      assigneeUserId: ids.user,
      resolvedAt: new Date(now.getTime() - 60_000),
      lastActivityAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: new Date(now.getTime() - 60_000),
    },
    {
      id: ids.noReplyConversation,
      inboxId: ids.inbox,
      teamId: ids.team,
      contactId: ids.noReplyContact,
      displayId: 2,
      status: 'resolved',
      resolvedAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: new Date(now.getTime() - 60_000),
    },
    {
      id: ids.optedOutConversation,
      inboxId: ids.inbox,
      teamId: ids.team,
      contactId: ids.optedOutContact,
      displayId: 3,
      status: 'resolved',
      resolvedAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: new Date(now.getTime() - 60_000),
    },
  ])
  await db.insert(conversationMessage).values({
    id: ids.reply,
    conversationId: ids.conversation,
    kind: 'outgoing',
    body: 'We fixed that for you.',
    senderKind: 'agent',
    senderUserId: ids.user,
    isPrivate: false,
    deliveryStatus: 'sent',
    createdAt: new Date(now.getTime() - 120_000),
  })
  await db.insert(csatSurvey).values({
    id: ids.survey,
    teamId: ids.team,
    inboxId: ids.inbox,
    name: 'Default CSAT',
    scale: 'csat_5',
    question: 'How was your support experience?',
    followUpQuestion: 'What could we improve?',
    sendTrigger: 'on_resolve',
    delayMinutes: 0,
    contactCooldownMinutes: 60,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('CSAT dispatch (real Postgres)', () => {
  it('sends once, queues durable delivery, and honors reply/opt-out guards', async () => {
    const first = await runCsatDispatchSweep({ now })
    const [response] = await db.select().from(csatResponse).where(eq(csatResponse.conversationId, ids.conversation))
    expect(first.sent).toBe(1)
    expect(response?.surveyId).toBe(ids.survey)
    expect(response?.token).toHaveLength(43)

    const second = await runCsatDispatchSweep({ now })
    const allResponses = await db.select().from(csatResponse).where(eq(csatResponse.surveyId, ids.survey))
    const [delivery] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.kind, 'csat'))

    expect(second.sent).toBe(0)
    expect(allResponses).toHaveLength(1)
    expect(delivery?.idempotencyKey).toBe(`csat:${response?.id}`)
    expect(delivery?.payload).toMatchObject({ to: expect.any(String), subject: 'How did we do?' })
  })
})
