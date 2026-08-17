import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportEmailEvent, supportInbox } from '../../server/database/schema/support'
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

  test('creates a ticket, threads a reply onto it, and ignores a duplicate delivery', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)

    const teamResponse = await request.get('/api/teams/active', { headers })
    const teamId = (await teamResponse.json()).data.id as string

    const suffix = randomUUID().slice(0, 8)
    const inboxAddress = `inbound-${suffix}@example.com`
    const createdInboxIds: string[] = []
    const providerEventIds: string[] = []

    try {
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers,
        data: { teamId, name: `E2E Inbound ${suffix}`, slug: `e2e-inbound-${suffix}` },
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
    }
  })
})
