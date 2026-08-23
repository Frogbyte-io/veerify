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
 * Stage 04 acceptance: the full round trip. An agent reply to an inbound
 * ticket carries real threading headers, and the customer's reply to it
 * lands on the same conversation rather than opening a new ticket - the
 * stage's headline risk (parallel-agents.md: a bracketed `channelMessageId`
 * would make every customer reply open a new ticket).
 *
 * Guarded like `support-inbound-email.spec.ts`: skips when the Postmark
 * webhook credentials are unset, since both legs of the round trip start
 * from an inbound delivery.
 *
 * Not covered here: acceptance criterion 1 ("same thread in Gmail and
 * Outlook") needs real mailboxes at both providers and cannot be asserted
 * from this suite (TODO.md says so explicitly - verify by hand). Also not
 * covered: "contact has no email" returning 409 - unreachable through the
 * email channel, since every inbound delivery carries a From address that
 * becomes the contact's email. Only "inbox has no sending address" is
 * exercised below.
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

test.describe.serial('outbound reply round trip', () => {
  test.skip(!credentialsConfigured, 'SUPPORT_POSTMARK_WEBHOOK_USER/PASSWORD not configured')

  test('agent reply threads correctly, and the customer reply to it lands on the same conversation', async ({
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)

    const teamResponse = await request.get('/api/teams/active', { headers })
    const teamId = (await teamResponse.json()).data.id as string

    const suffix = randomUUID().slice(0, 8)
    const inboxAddress = `inbound-${suffix}@example.com`
    const agentSendingAddress = `agent-${suffix}@example.com`
    const customerEmail = `customer-${suffix}@example.com`
    const createdInboxIds: string[] = []
    const providerEventIds: string[] = []

    // Same dance as support-inbound-email.spec.ts: supportEnabled defaults
    // to false per team (delta D-31).
    const modulesBefore = await request.get(`/api/teams/${teamId}/modules`, { headers })
    const supportWasEnabled = Boolean((await modulesBefore.json())?.data?.modules?.supportEnabled)
    const enableSupport = await request.put(`/api/teams/${teamId}/modules`, {
      headers,
      data: { supportEnabled: true },
    })
    expect(enableSupport.ok()).toBeTruthy()

    try {
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers,
        data: { teamId, name: `E2E Outbound ${suffix}`, slug: `e2e-outbound-${suffix}` },
      })
      expect(inboxResponse.ok()).toBeTruthy()
      const inboxId = (await inboxResponse.json()).data.inbox.id as string
      createdInboxIds.push(inboxId)

      const addressResponse = await request.post(`/api/support/inboxes/${inboxId}/addresses`, {
        headers,
        data: { address: inboxAddress },
      })
      expect(addressResponse.ok()).toBeTruthy()

      // --- 0. A reply attempt with no sending address configured is rejected -
      // SUP-04-6 surfaces this in settings; this is the backstop assertion
      // that it also fails loudly server-side rather than queuing a delivery
      // that can never send (messages/index.post.ts).
      const firstId = `first-${suffix}@mail.example.com`
      providerEventIds.push(firstId)

      const inbound = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: firstId,
          to: inboxAddress,
          subject: 'Cannot export my data',
          text: 'The export button does nothing.',
          from: customerEmail,
        }),
      })
      expect(inbound.status()).toBe(200)

      const afterInbound = await db.select().from(conversation).where(eq(conversation.inboxId, inboxId))
      expect(afterInbound).toHaveLength(1)
      const conversationId = afterInbound[0].id

      const rejectedReply = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'Looking into this now.' },
      })
      expect(rejectedReply.status()).toBe(409)

      // --- 1. Give the inbox a sending address, then reply -------------------
      const inboxUpdate = await request.put(`/api/support/inboxes/${inboxId}`, {
        headers,
        data: { emailAddress: agentSendingAddress, fromName: 'E2E Support' },
      })
      expect(inboxUpdate.ok()).toBeTruthy()

      // A note must never carry attachments - SUP-04-4's .superRefine rejects
      // it outright rather than silently dropping them (parallel-agents.md).
      const noteWithAttachment = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: {
          kind: 'note',
          body: 'Internal only.',
          attachments: [{ storageKey: 'support/x', fileName: 'x.pdf', contentType: 'application/pdf', sizeBytes: 10 }],
        },
      })
      expect(noteWithAttachment.status()).toBe(400)

      const reply = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'Looking into this now - the export endpoint was timing out.' },
      })
      expect(reply.ok()).toBeTruthy()
      const replyMessage = (await reply.json()).data.message as Record<string, unknown>

      // Set synchronously in the same transaction as the insert, regardless of
      // whether the async send has resolved yet - this is what the customer's
      // reply threads on.
      expect(replyMessage.channelMessageId).toBeTruthy()
      const replyChannelMessageId = replyMessage.channelMessageId as string

      // --- 2. deliveryStatus must leave 'pending' ----------------------------
      // Regression coverage for the bug this item found: before SUP-04-10,
      // nothing ever updated conversationMessage.deliveryStatus past its
      // insert-time value, so this would have stayed 'pending' forever no
      // matter what happened. Tolerates either outcome of the actual SMTP
      // attempt (this box's SMTP config is not this assertion's concern) -
      // only that *something* updated it.
      let finalStatus: string | undefined
      for (let attempt = 0; attempt < 10; attempt++) {
        const messagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, {
          headers,
        })
        const messages = (await messagesResponse.json()).data.messages as Array<Record<string, unknown>>
        const found = messages.find((m) => m.id === replyMessage.id)
        finalStatus = found?.deliveryStatus as string | undefined
        if (finalStatus && finalStatus !== 'pending') break
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      expect(finalStatus).not.toBe('pending')
      expect(['sent', 'failed']).toContain(finalStatus)

      // --- 3. The customer's reply to it lands on the SAME conversation -----
      // This is the headline risk: a bracketed channelMessageId stored on
      // in-reply-to would make this open a new ticket instead.
      const customerReplyId = `customer-reply-${suffix}@mail.example.com`
      providerEventIds.push(customerReplyId)

      const customerReply = await request.post('/api/support/inbound/postmark', {
        headers: { Authorization: basicAuth() },
        data: postmarkPayload({
          messageId: customerReplyId,
          to: inboxAddress,
          subject: 'Re: Cannot export my data',
          text: 'Still broken, same error.',
          inReplyTo: replyChannelMessageId,
          from: customerEmail,
        }),
      })
      expect(customerReply.status()).toBe(200)

      const afterCustomerReply = await db.select().from(conversation).where(eq(conversation.inboxId, inboxId))
      expect(afterCustomerReply).toHaveLength(1)
      expect(afterCustomerReply[0].id).toBe(conversationId)

      const finalMessagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, {
        headers,
      })
      const finalMessages = (await finalMessagesResponse.json()).data.messages as Array<Record<string, unknown>>
      expect(finalMessages.filter((m) => m.kind === 'incoming')).toHaveLength(2)
      expect(finalMessages.filter((m) => m.kind === 'outgoing')).toHaveLength(1)

      // --- 4. Retrying a message that is not failed is rejected -------------
      const retryOnSent = await request.post(
        `/api/support/conversations/${conversationId}/messages/${replyMessage.id}/retry`,
        { headers }
      )
      expect([200, 409]).toContain(retryOnSent.status())
      // 200 only if the send genuinely failed (finalStatus === 'failed'); a
      // successful send must reject the retry.
      if (finalStatus === 'sent') {
        expect(retryOnSent.status()).toBe(409)
      }
    } finally {
      if (providerEventIds.length > 0) {
        await db.delete(supportEmailEvent).where(inArray(supportEmailEvent.providerEventId, providerEventIds))
      }
      for (const inboxId of createdInboxIds) {
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
      await db.delete(contact).where(eq(contact.email, customerEmail))

      if (!supportWasEnabled) {
        await request.put(`/api/teams/${teamId}/modules`, { headers, data: { supportEnabled: false } })
      }
    }
  })
})
