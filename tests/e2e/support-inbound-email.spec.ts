import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { team, teamMember } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import {
  contact,
  contactIdentity,
  conversation,
  conversationMessage,
  supportEmailEvent,
  supportInbox,
  supportInboxAddress,
} from '../../server/database/schema/support'
import { teamModuleSettings } from '../../server/database/schema/teams'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

const WEBHOOK_USER = process.env.SUPPORT_POSTMARK_WEBHOOK_USER || ''
const WEBHOOK_PASSWORD = process.env.SUPPORT_POSTMARK_WEBHOOK_PASSWORD || ''

/**
 * Stage 03 acceptance: inbound mail creates a ticket, a reply threads onto the
 * same conversation, and a duplicate delivery does not double it.
 *
 * Skips when the Postmark webhook credentials are unset, following the same
 * guarded pattern as the Redis and Postgres integration suites — the endpoint
 * rejects unauthenticated deliveries by design, so without credentials there is
 * nothing to assert beyond the 401.
 */
const credentialsConfigured = Boolean(WEBHOOK_USER && WEBHOOK_PASSWORD)

function basicAuth() {
  return 'Basic ' + Buffer.from(`${WEBHOOK_USER}:${WEBHOOK_PASSWORD}`).toString('base64')
}

interface MailOptions {
  messageId: string
  to: string
  subject: string
  text: string
  inReplyTo?: string
  from?: string
}

/** A Postmark inbound webhook payload, trimmed to the fields the driver reads. */
function postmarkPayload(options: MailOptions) {
  const headers = [{ Name: 'Message-ID', Value: `<${options.messageId}>` }]
  if (options.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: `<${options.inReplyTo}>` })

  return {
    MessageID: options.messageId,
    FromFull: { Email: options.from ?? 'customer@example.com', Name: 'E2E Customer' },
    ToFull: [{ Email: options.to, Name: 'Support' }],
    CcFull: [],
    Subject: options.subject,
    TextBody: options.text,
    HtmlBody: `<p>${options.text}</p>`,
    Headers: headers,
    Attachments: [],
  }
}

test.describe.serial('inbound email', () => {
  test.skip(!credentialsConfigured, 'SUPPORT_POSTMARK_WEBHOOK_USER/PASSWORD not configured')

  test('returns a retryable error after a claimed delivery fails processing', async ({ request }) => {
    const providerEventId = `malformed-${randomUUID()}@mail.example.com`

    try {
      const response = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        // MessageID is sufficient to claim the event, but the missing sender
        // makes the Postmark driver fail during processing.
        data: { MessageID: providerEventId },
      })

      expect(response.status()).toBe(500)

      const retry = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: { MessageID: providerEventId },
      })
      expect(retry.status()).toBe(500)

      const [recorded] = await db
        .select({ status: supportEmailEvent.status, attemptCount: supportEmailEvent.attemptCount })
        .from(supportEmailEvent)
        .where(eq(supportEmailEvent.providerEventId, providerEventId))
        .limit(1)
      expect(recorded).toEqual({ status: 'failed', attemptCount: 2 })
    } finally {
      await db.delete(supportEmailEvent).where(eq(supportEmailEvent.providerEventId, providerEventId))
    }
  })

  test('scopes duplicate RFC IDs by inbox and creates a diagnosed ticket for same-inbox ambiguity', async ({
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)
    const activeTeamId = (await (await request.get('/api/teams/active', { headers })).json()).data.id as string
    const [activeTeam] = await db
      .select({ organizationId: team.organizationId })
      .from(team)
      .where(eq(team.id, activeTeamId))
      .limit(1)
    expect(activeTeam).toBeTruthy()
    if (!activeTeam) throw new Error('Active team fixture disappeared')

    const suffix = randomUUID().slice(0, 8)
    const teamIds = [`thread-team-a-${suffix}`, `thread-team-b-${suffix}`]
    const inboxIds = [`thread-inbox-a-${suffix}`, `thread-inbox-b-${suffix}`]
    const addresses = [`thread-a-${suffix}@example.com`, `thread-b-${suffix}@example.com`]
    const contactIds = [`thread-contact-a-${suffix}`, `thread-contact-b-${suffix}`]
    const conversationIds = [`thread-conversation-a-${suffix}`, `thread-conversation-b-${suffix}`]
    const sharedRfcId = `shared-${suffix}@mail.example.com`
    const providerEventIds: string[] = []
    const now = new Date()

    try {
      await db.insert(team).values(
        teamIds.map((id, index) => ({
          id,
          name: `Thread Team ${index + 1} ${suffix}`,
          slug: `thread-team-${index + 1}-${suffix}`,
          organizationId: activeTeam.organizationId,
          createdAt: now,
          updatedAt: now,
        }))
      )
      await db.insert(teamModuleSettings).values(
        teamIds.map((teamId) => ({ teamId, supportEnabled: true, createdAt: now, updatedAt: now }))
      )
      await db.insert(supportInbox).values(
        inboxIds.map((id, index) => ({
          id,
          teamId: teamIds[index],
          name: `Thread Inbox ${index + 1}`,
          slug: `thread-inbox-${index + 1}-${suffix}`,
          createdAt: now,
          updatedAt: now,
        }))
      )
      await db.insert(supportInboxAddress).values(
        inboxIds.map((inboxId, index) => ({
          id: `thread-address-${index + 1}-${suffix}`,
          inboxId,
          address: addresses[index],
          isPrimary: true,
          createdAt: now,
        }))
      )
      await db.insert(contact).values(
        contactIds.map((id, index) => ({
          id,
          teamId: teamIds[index],
          name: `Thread Customer ${index + 1}`,
          email: `thread-customer-${index + 1}-${suffix}@example.com`,
          createdAt: now,
          updatedAt: now,
        }))
      )
      await db.insert(contactIdentity).values(
        contactIds.map((contactId, index) => ({
          id: `thread-contact-identity-${index + 1}-${suffix}`,
          contactId,
          teamId: teamIds[index],
          kind: 'email',
          value: `thread-customer-${index + 1}-${suffix}@example.com`,
          createdAt: now,
        }))
      )
      await db.insert(conversation).values(
        conversationIds.map((id, index) => ({
          id,
          inboxId: inboxIds[index],
          teamId: teamIds[index],
          contactId: contactIds[index],
          displayId: 100,
          subject: 'Shared provider identity',
          status: 'open',
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        }))
      )
      await db.insert(conversationMessage).values(
        conversationIds.map((conversationId, index) => ({
          id: `thread-message-${index + 1}-${suffix}`,
          conversationId,
          kind: 'incoming',
          body: 'Original message',
          senderKind: 'contact',
          senderContactId: contactIds[index],
          isPrivate: false,
          channelMessageId: sharedRfcId,
          deliveryStatus: 'delivered',
          createdAt: now,
        }))
      )

      for (const index of [0, 1]) {
        const eventId = `scoped-reply-${index + 1}-${suffix}@mail.example.com`
        providerEventIds.push(eventId)
        const response = await request.post('/api/support/inbound/postmark', {
          headers: { Authorization: basicAuth() },
          data: postmarkPayload({
            messageId: eventId,
            to: addresses[index],
            from: `thread-customer-${index + 1}-${suffix}@example.com`,
            subject: 'Re: Shared provider identity',
            text: `Reply for inbox ${index + 1}`,
            inReplyTo: sharedRfcId,
          }),
        })
        expect(response.status()).toBe(200)

        const rows = await db
          .select({ conversationId: conversationMessage.conversationId })
          .from(conversationMessage)
          .where(eq(conversationMessage.channelMessageId, eventId))
        expect(rows).toEqual([{ conversationId: conversationIds[index] }])
      }

      const collisionConversationId = `thread-collision-${suffix}`
      await db.insert(conversation).values({
        id: collisionConversationId,
        inboxId: inboxIds[0],
        teamId: teamIds[0],
        contactId: contactIds[0],
        displayId: 101,
        subject: 'Shared provider identity',
        status: 'open',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversationMessage).values({
        id: `thread-collision-message-${suffix}`,
        conversationId: collisionConversationId,
        kind: 'incoming',
        body: 'Conflicting identity',
        senderKind: 'contact',
        senderContactId: contactIds[0],
        isPrivate: false,
        channelMessageId: sharedRfcId,
        deliveryStatus: 'delivered',
        createdAt: now,
      })

      const ambiguousEventId = `ambiguous-${suffix}@mail.example.com`
      providerEventIds.push(ambiguousEventId)
      const ambiguous = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: ambiguousEventId,
          to: addresses[0],
          from: `thread-customer-1-${suffix}@example.com`,
          subject: 'Re: Shared provider identity',
          text: 'This must start a diagnosed ticket.',
          inReplyTo: sharedRfcId,
        }),
      })
      expect(ambiguous.status()).toBe(200)

      const created = await db.select().from(conversation).where(eq(conversation.inboxId, inboxIds[0]))
      const collisionTicket = created.find(
        (row) => (row.metadata as Record<string, unknown> | null)?.threadingCollision !== undefined
      )
      expect(collisionTicket?.id).not.toBe(conversationIds[0])
      expect(collisionTicket?.id).not.toBe(collisionConversationId)
      expect(collisionTicket?.metadata).toMatchObject({
        threadingCollision: {
          type: 'ambiguous-message-id',
          headerMessageId: sharedRfcId,
          occurredAt: expect.any(String),
        },
      })
    } finally {
      if (providerEventIds.length > 0) {
        await db.delete(supportEmailEvent).where(inArray(supportEmailEvent.providerEventId, providerEventIds))
      }
      await db.delete(conversation).where(inArray(conversation.teamId, teamIds))
      await db.delete(supportInbox).where(inArray(supportInbox.id, inboxIds))
      await db.delete(contact).where(inArray(contact.teamId, teamIds))
      await db.delete(team).where(inArray(team.id, teamIds))
    }
  })

  test('creates a ticket, threads a reply onto it, and ignores a duplicate delivery', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)

    const teamResponse = await request.get('/api/teams/active', { headers })
    const teamId = (await teamResponse.json()).data.id as string
    const sessionResponse = await request.get('/api/auth/session', { headers })
    const seedUserId = (await sessionResponse.json()).data.user.id as string
    const [membershipBefore] = await db
      .select({ id: teamMember.id, role: teamMember.role })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, seedUserId)))
      .limit(1)
    expect(membershipBefore).toBeTruthy()
    if (!membershipBefore) throw new Error('Seed team membership fixture disappeared')
    if (membershipBefore.role !== 'admin') {
      await db.update(teamMember).set({ role: 'admin' }).where(eq(teamMember.id, membershipBefore.id))
    }

    const suffix = randomUUID().slice(0, 8)
    const inboxAddress = `inbound-${suffix}@example.com`
    const createdInboxIds: string[] = []
    const providerEventIds: string[] = []
    const legacyProjectId = randomUUID()

    // `supportEnabled` defaults to FALSE for every team (delta D-31), and the
    // inbound endpoint honours it by design (SUP-03-10): it records the event,
    // returns 200, and creates nothing. Without switching the module on first,
    // every assertion below fails against a correctly working pipeline.
    let supportWasEnabled = false

    try {
      const modulesBefore = await request.get(`/api/teams/${teamId}/modules`, { headers })
      supportWasEnabled = Boolean((await modulesBefore.json())?.data?.modules?.supportEnabled)

      const enableSupport = await request.put(`/api/teams/${teamId}/modules`, {
        headers,
        data: { supportEnabled: true },
      })
      expect(
        enableSupport.ok(),
        `enable Support failed: ${enableSupport.status()} ${await enableSupport.text()}`
      ).toBeTruthy()

      const [activeTeam] = await db
        .select({ organizationId: team.organizationId })
        .from(team)
        .where(eq(team.id, teamId))
        .limit(1)
      expect(activeTeam).toBeTruthy()
      if (!activeTeam) throw new Error('Active team fixture disappeared')
      await db.insert(project).values({
        id: legacyProjectId,
        organizationId: activeTeam.organizationId,
        teamId,
        slug: `e2e-inbound-legacy-${suffix}`,
        name: `E2E Inbound Legacy ${suffix}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const inboxResponse = await request.post('/api/support/inboxes', {
        headers,
        data: {
          teamId,
          name: `E2E Inbound ${suffix}`,
          slug: `e2e-inbound-${suffix}`,
          projectId: legacyProjectId,
        },
      })
      expect(inboxResponse.ok()).toBeTruthy()
      const inboxId = (await inboxResponse.json()).data.inbox.id as string
      createdInboxIds.push(inboxId)

      // The receiving address is what resolves inbound mail to this inbox.
      const addressResponse = await request.post(`/api/support/inboxes/${inboxId}/addresses`, {
        headers,
        data: { address: inboxAddress },
      })
      expect(addressResponse.ok()).toBeTruthy()

      // --- 1. First delivery creates a conversation -------------------------
      const firstId = `first-${suffix}@mail.example.com`
      providerEventIds.push(firstId)

      const first = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: firstId,
          to: inboxAddress,
          subject: 'Cannot sign in',
          text: 'I cannot sign in to my account.',
        }),
      })
      expect(first.status()).toBe(200)

      const afterFirst = await db.select().from(conversation).where(eq(conversation.inboxId, inboxId))
      expect(afterFirst).toHaveLength(1)
      const conversationId = afterFirst[0].id
      expect(afterFirst[0].subject).toBe('Cannot sign in')
      expect(afterFirst[0].projectId).toBeNull()

      // --- 2. A reply threads onto the SAME conversation --------------------
      const replyId = `reply-${suffix}@mail.example.com`
      providerEventIds.push(replyId)

      const reply = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: replyId,
          to: inboxAddress,
          subject: 'Re: Cannot sign in',
          text: 'Still broken after a password reset.',
          inReplyTo: firstId,
        }),
      })
      expect(reply.status()).toBe(200)

      const afterReply = await db.select().from(conversation).where(eq(conversation.inboxId, inboxId))
      expect(afterReply).toHaveLength(1)
      expect(afterReply[0].id).toBe(conversationId)

      const messagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      const messages = (await messagesResponse.json()).data.messages as Array<Record<string, unknown>>
      expect(messages.filter((m) => m.kind === 'incoming')).toHaveLength(2)

      // --- 3. Replaying the first delivery must not double anything ---------
      // Providers retry aggressively; the supportEmailEvent claim is what makes
      // that safe. Same providerEventId, so it must be recognised as seen.
      const duplicate = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: firstId,
          to: inboxAddress,
          subject: 'Cannot sign in',
          text: 'I cannot sign in to my account.',
        }),
      })
      expect(duplicate.status()).toBe(200)

      const afterDuplicate = await db.select().from(conversation).where(eq(conversation.inboxId, inboxId))
      expect(afterDuplicate).toHaveLength(1)

      const messagesAfterDuplicate = await request.get(`/api/support/conversations/${conversationId}/messages`, {
        headers,
      })
      const finalMessages = (await messagesAfterDuplicate.json()).data.messages as Array<Record<string, unknown>>
      expect(finalMessages.filter((m) => m.kind === 'incoming')).toHaveLength(2)

      // --- 4. An unauthenticated delivery is rejected -----------------------
      const unauthenticated = await request.post('/api/support/inbound/postmark', {
        data: postmarkPayload({
          messageId: `rogue-${suffix}@mail.example.com`,
          to: inboxAddress,
          subject: 'Rogue',
          text: 'Should never be stored.',
        }),
      })
      expect(unauthenticated.status()).toBe(401)
    } finally {
      if (providerEventIds.length > 0) {
        await db.delete(supportEmailEvent).where(inArray(supportEmailEvent.providerEventId, providerEventIds))
      }
      for (const inboxId of createdInboxIds) {
        // Conversations reference the inbox with onDelete restrict.
        const rows = await db
          .select({ id: conversation.id })
          .from(conversation)
          .where(eq(conversation.inboxId, inboxId))
        if (rows.length > 0) {
          await db.delete(conversation).where(
            inArray(
              conversation.id,
              rows.map((r) => r.id)
            )
          )
        }
        await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
      }
      await db.delete(contact).where(eq(contact.email, 'customer@example.com'))
      await db.delete(project).where(eq(project.id, legacyProjectId))

      // The seed team is shared with every other spec, so put the module back
      // the way it was rather than leaving Support switched on behind us.
      if (!supportWasEnabled) {
        await request.put(`/api/teams/${teamId}/modules`, { headers, data: { supportEnabled: false } })
      }
      if (membershipBefore.role !== 'admin') {
        await db.update(teamMember).set({ role: membershipBefore.role }).where(eq(teamMember.id, membershipBefore.id))
      }
    }
  })
})
