import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import {
  contact,
  conversation,
  supportAttachmentUpload,
  supportEmailEvent,
  supportInbox,
  supportOutboundDelivery,
} from '../../server/database/schema/support'
import { getPlaywrightBaseURL, signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'
import { account, session, teamMember, user, verification } from '../../server/database/schema/auth'

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
    let conversationId: string | undefined

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
      conversationId = afterInbound[0].id

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

      // --- 1a. Upload sessions expose only opaque ids ----------------------
      // The composer uses the same proxy target as this request in the local
      // runtime. The upload id is the only attachment reference that may cross
      // the message API boundary; storage keys must never reach the browser.
      const uploadBytes = 'Attachment bytes for E2E'
      const upload = await request.post('/api/support/attachments/presign', {
        headers,
        data: {
          conversationId,
          filename: 'e2e-invoice.txt',
          contentType: 'text/plain',
          sizeBytes: Buffer.byteLength(uploadBytes),
        },
      })
      expect(upload.ok()).toBeTruthy()
      const uploadTarget = (await upload.json()).data as Record<string, unknown>
      expect(uploadTarget.uploadId).toBeTruthy()
      expect(uploadTarget).not.toHaveProperty('storageKey')
      expect(String(uploadTarget.uploadUrl)).toContain('/api/support/attachments/upload/')

      const uploadResponse = await request.put(String(uploadTarget.uploadUrl), {
        headers: { ...headers, 'content-type': 'text/plain' },
        data: uploadBytes,
      })
      expect(uploadResponse.ok()).toBeTruthy()

      const legacyAttachment = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: {
          kind: 'outgoing',
          body: 'Legacy references must be rejected.',
          attachments: [{ storageKey: 'support/secret.txt' }],
        },
      })
      expect(legacyAttachment.status()).toBe(400)

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
        data: {
          kind: 'outgoing',
          body: 'Looking into this now - the export endpoint was timing out.',
          attachments: [{ uploadId: uploadTarget.uploadId }],
        },
      })
      expect(reply.ok()).toBeTruthy()
      const replyMessage = (await reply.json()).data.message as Record<string, unknown>

      // Set synchronously in the same transaction as the insert, regardless of
      // whether the async send has resolved yet - this is what the customer's
      // reply threads on.
      expect(replyMessage.channelMessageId).toBeTruthy()
      expect(replyMessage).not.toHaveProperty('storageKey')
      const replyChannelMessageId = replyMessage.channelMessageId as string

      const persistedMessagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, {
        headers,
      })
      expect(persistedMessagesResponse.ok()).toBeTruthy()
      const persistedReply = (await persistedMessagesResponse.json()).data.messages.find(
        (message: Record<string, unknown>) => message.id === replyMessage.id
      ) as Record<string, unknown>
      expect(persistedReply.attachments).toEqual([
        expect.objectContaining({
          fileName: 'e2e-invoice.txt',
          contentType: 'text/plain',
          sizeBytes: Buffer.byteLength(uploadBytes),
          downloadUrl: expect.stringMatching(/^\/api\/support\/attachments\//),
        }),
      ])
      expect(JSON.stringify(persistedReply)).not.toContain('storageKey')

      // --- 2. The first durable delivery attempt completes ------------------
      // A retryable SMTP failure intentionally remains pending now, but it
      // must carry an attempt count and a persisted future due time rather
      // than being immediately reclaimed in this worker pass.
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
      expect(['pending', 'sent', 'failed']).toContain(finalStatus)
      if (finalStatus === 'pending') {
        const [delivery] = await db
          .select()
          .from(supportOutboundDelivery)
          .where(eq(supportOutboundDelivery.messageId, replyMessage.id as string))
        expect(delivery.attemptCount).toBeGreaterThan(0)
        expect(delivery.nextAttemptAt).not.toBeNull()
        expect(delivery.lastError).toBeTruthy()
      }

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
      // 200 only if all automatic attempts genuinely failed. Sent and
      // scheduled-pending deliveries must reject a manual retry.
      if (finalStatus !== 'failed') {
        expect(retryOnSent.status()).toBe(409)
      }
    } finally {
      if (providerEventIds.length > 0) {
        await db.delete(supportEmailEvent).where(inArray(supportEmailEvent.providerEventId, providerEventIds))
      }
      if (conversationId) {
        await db.delete(supportAttachmentUpload).where(eq(supportAttachmentUpload.conversationId, conversationId))
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

// Attachment API coverage is deliberately independent from the Postmark
// round-trip above. Local development has no provider webhook credentials,
// but still needs deterministic proof for the upload/message contract.
test.describe.serial('outbound attachment contract', () => {
  test('uploads through the proxy and persists only an opaque upload id', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)
    const teamResponse = await request.get('/api/teams/active', { headers })
    expect(teamResponse.ok()).toBeTruthy()
    const teamId = (await teamResponse.json()).data.id as string
    const suffix = randomUUID().slice(0, 8)
    const customerEmail = `attachment-${suffix}@example.com`
    const adminCredentials = { email: `attachment-admin-${suffix}@example.com`, password: TEST_PASSWORD }
    const inboxIds: string[] = []
    const conversationIds: string[] = []
    let conversationId: string | undefined
    let adminUserId: string | undefined
    let teamMemberId: string | undefined

    try {
      const signupResponse = await request.post('/api/auth/sign-up/email', {
        headers: withOriginHeaders('/signup'),
        data: { name: 'Attachment setup admin', ...adminCredentials },
      })
      expect(signupResponse.ok()).toBeTruthy()
      adminUserId = ((await signupResponse.json()).user?.id || '') as string
      teamMemberId = randomUUID()
      await db
        .insert(teamMember)
        .values({ id: teamMemberId, teamId, userId: adminUserId, role: 'admin', createdAt: new Date() })
      const adminCookie = await signInAndGetSessionCookie(request, adminCredentials)
      const adminHeaders = withAuthHeaders(adminCookie)
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers: adminHeaders,
        data: { teamId, name: `E2E Attachment ${suffix}`, slug: `e2e-attachment-${suffix}` },
      })
      expect(inboxResponse.ok()).toBeTruthy()
      const inboxId = (await inboxResponse.json()).data.inbox.id as string
      inboxIds.push(inboxId)
      const seedSession = await request.get('/api/auth/session', { headers })
      const seedUserId = (await seedSession.json()).data.user.id as string
      const memberResponse = await request.post(`/api/support/inboxes/${inboxId}/members`, {
        headers: adminHeaders,
        data: { userId: seedUserId, role: 'agent' },
      })
      expect(memberResponse.ok()).toBeTruthy()
      const contactResponse = await request.post('/api/support/contacts', {
        headers: adminHeaders,
        data: { teamId, name: 'Attachment Customer', email: customerEmail },
      })
      expect(contactResponse.ok()).toBeTruthy()
      const contactId = (await contactResponse.json()).data.contact.id as string
      const conversationResponse = await request.post('/api/support/conversations', {
        headers,
        data: { inboxId, contactId, subject: 'Attachment contract' },
      })
      expect(conversationResponse.ok()).toBeTruthy()
      conversationId = (await conversationResponse.json()).data.conversation.id as string
      conversationIds.push(conversationId)
      await request.put(`/api/support/inboxes/${inboxId}`, {
        headers: adminHeaders,
        data: { emailAddress: `attachment-sender-${suffix}@example.com`, fromName: 'E2E Support' },
      })

      const bytes = 'proxy attachment contract'
      const presign = await request.post('/api/support/attachments/presign', {
        headers,
        data: {
          conversationId,
          filename: 'contract.txt',
          contentType: 'text/plain',
          sizeBytes: Buffer.byteLength(bytes),
        },
      })
      expect(presign.ok()).toBeTruthy()
      const target = (await presign.json()).data as Record<string, unknown>
      expect(target.uploadId).toEqual(expect.any(String))
      expect(target).not.toHaveProperty('storageKey')
      expect(String(target.uploadUrl)).toContain('/api/support/attachments/upload/')
      const uploaded = await request.put(String(target.uploadUrl), {
        headers: { ...headers, 'content-type': 'text/plain' },
        data: bytes,
      })
      expect(uploaded.ok()).toBeTruthy()

      const legacy = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'legacy', attachments: [{ storageKey: 'secret/key' }] },
      })
      expect(legacy.status()).toBe(400)
      const sent = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'Here is the requested file.', attachments: [{ uploadId: target.uploadId }] },
      })
      expect(sent.ok()).toBeTruthy()
      const messages = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      expect(messages.ok()).toBeTruthy()
      const reply = ((await messages.json()).data.messages as Array<Record<string, unknown>>).find(
        (message) => message.kind === 'outgoing'
      )
      expect(reply?.attachments).toEqual([
        expect.objectContaining({
          fileName: 'contract.txt',
          downloadUrl: expect.stringMatching(/^\/api\/support\/attachments\//),
        }),
      ])
      expect(JSON.stringify(reply)).not.toContain('storageKey')
    } finally {
      if (conversationIds.length) await db.delete(conversation).where(inArray(conversation.id, conversationIds))
      if (conversationId)
        await db.delete(supportAttachmentUpload).where(eq(supportAttachmentUpload.conversationId, conversationId))
      await db.delete(contact).where(eq(contact.email, customerEmail))
      if (inboxIds.length) await db.delete(supportInbox).where(inArray(supportInbox.id, inboxIds))
      if (teamMemberId) await db.delete(teamMember).where(eq(teamMember.id, teamMemberId))
      if (adminUserId) {
        await db.delete(verification).where(eq(verification.identifier, adminCredentials.email))
        await db.delete(session).where(eq(session.userId, adminUserId))
        await db.delete(account).where(eq(account.userId, adminUserId))
        await db.delete(user).where(eq(user.id, adminUserId))
      }
    }
  })

  test('shows upload phases, protects note mode, handles expiry/retry, and renders the persisted download chip', async ({
    request,
    page,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)
    const teamId = (await (await request.get('/api/teams/active', { headers })).json()).data.id as string
    const suffix = randomUUID().slice(0, 8)
    const adminCredentials = { email: `attachment-ui-admin-${suffix}@example.com`, password: TEST_PASSWORD }
    const signup = await request.post('/api/auth/sign-up/email', {
      headers: withOriginHeaders('/signup'),
      data: { name: 'Attachment UI setup admin', ...adminCredentials },
    })
    expect(signup.ok()).toBeTruthy()
    const adminUserId = (await signup.json()).user.id as string
    const teamMemberId = randomUUID()
    await db
      .insert(teamMember)
      .values({ id: teamMemberId, teamId, userId: adminUserId, role: 'admin', createdAt: new Date() })
    const adminCookie = await signInAndGetSessionCookie(request, adminCredentials)
    const adminHeaders = withAuthHeaders(adminCookie)
    const customerEmail = `attachment-ui-${suffix}@example.com`
    let inboxId: string | undefined
    let conversationId: string | undefined

    try {
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers: adminHeaders,
        data: { teamId, name: `Attachment UI ${suffix}`, slug: `e2e-attachment-ui-${suffix}` },
      })
      expect(inboxResponse.ok()).toBeTruthy()
      inboxId = (await inboxResponse.json()).data.inbox.id as string
      const seedUserId = (await (await request.get('/api/auth/session', { headers })).json()).data.user.id as string
      expect(
        (
          await request.post(`/api/support/inboxes/${inboxId}/members`, {
            headers: adminHeaders,
            data: { userId: seedUserId, role: 'agent' },
          })
        ).ok()
      ).toBeTruthy()
      const contactResponse = await request.post('/api/support/contacts', {
        headers,
        data: { teamId, name: 'Attachment UI Customer', email: customerEmail },
      })
      expect(contactResponse.ok()).toBeTruthy()
      const contactId = (await contactResponse.json()).data.contact.id as string
      const conversationResponse = await request.post('/api/support/conversations', {
        headers,
        data: { inboxId, contactId, subject: 'Attachment UI' },
      })
      expect(conversationResponse.ok()).toBeTruthy()
      conversationId = (await conversationResponse.json()).data.conversation.id as string
      expect(
        (
          await request.put(`/api/support/inboxes/${inboxId}`, {
            headers: adminHeaders,
            data: { emailAddress: `attachment-ui-sender-${suffix}@example.com` },
          })
        ).ok()
      ).toBeTruthy()

      let presignCount = 0
      let directUploadCount = 0
      const directCompletionOrder: string[] = []
      let messageBody: Record<string, unknown> | undefined
      let deliveryRetryCount = 0
      const canonicalMessage = {
        id: 'ui-message-1',
        conversationId,
        kind: 'outgoing',
        body: 'Uploaded from the composer.',
        bodyHtml: null,
        senderKind: 'agent',
        senderUserId: seedUserId,
        senderContactId: null,
        isPrivate: false,
        deliveryStatus: 'failed',
        createdAt: new Date().toISOString(),
        attachments: [
          {
            id: 'ui-attachment-1',
            fileName: 'contract.txt',
            contentType: 'text/plain',
            sizeBytes: 16,
            downloadUrl: '/api/support/attachments/ui-attachment-1',
          },
        ],
      }
      await page.route('**/api/support/attachments/presign', async (route) => {
        presignCount += 1
        if (presignCount === 1) {
          await route.continue()
          return
        }
        const direct = presignCount === 2 || presignCount === 3
        const expiring = presignCount === 4
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              uploadId: `ui-upload-${presignCount}`,
              fileName: 'contract.txt',
              contentType: 'text/plain',
              uploadUrl: direct
                ? `https://uploads.test/blob-${presignCount}`
                : '/api/support/attachments/upload/ui-token',
              method: 'PUT',
              headers: { 'content-type': 'text/plain' },
              expiresAt: new Date(Date.now() + (expiring ? 150 : 60_000)).toISOString(),
            },
          }),
        })
      })
      await page.route('**/api/support/attachments/upload/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        await route.continue()
      })
      await page.route('https://uploads.test/blob-*', async (route) => {
        directUploadCount += 1
        if (directUploadCount === 1) {
          await route.fulfill({ status: 500, body: 'failed' })
        } else {
          directCompletionOrder.push('put')
          await route.fulfill({ status: 200, body: 'ok' })
        }
      })
      await page.route('**/api/support/attachments/ui-upload-*/complete', async (route) => {
        directCompletionOrder.push('complete')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { uploaded: true } }),
        })
      })
      await page.route(`**/api/support/conversations/${conversationId}/messages`, async (route) => {
        if (route.request().method() === 'POST') {
          messageBody = route.request().postDataJSON() as Record<string, unknown>
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { message: canonicalMessage } }),
          })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { messages: messageBody ? [canonicalMessage] : [], hasMore: false } }),
          })
        }
      })
      await page.route(`**/api/support/conversations/${conversationId}/messages/ui-message-1/retry`, async (route) => {
        deliveryRetryCount += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { retried: true, previousSubmissionAttempted: true } }),
        })
      })

      const [sessionCookieName, ...sessionCookieValueParts] = sessionCookie.split('=')
      await page.context().addCookies([
        {
          name: sessionCookieName,
          value: sessionCookieValueParts.join('='),
          url: getPlaywrightBaseURL(),
        },
      ])
      const browserSession = await page.request.get('/api/auth/session')
      expect(browserSession.ok()).toBeTruthy()
      await page.goto(`/support?inboxId=${inboxId}&conversationId=${conversationId}`, { waitUntil: 'domcontentloaded' })
      const composer = page.locator('[data-testid="support-composer-reply"]')
      await expect(composer).toBeVisible({ timeout: 30_000 })
      const input = page.locator('[data-testid="support-composer-file-input"]')
      await input.setInputFiles({ name: 'contract.txt', mimeType: 'text/plain', buffer: Buffer.from('proxy bytes') })
      await expect(
        page.locator('[data-testid^="support-composer-attachment-"][data-phase="uploading"]').first()
      ).toBeVisible()
      await expect(
        page.locator('[data-testid^="support-composer-attachment-"][data-phase="ready"]').first()
      ).toBeVisible({ timeout: 10_000 })
      await page.getByTestId('support-composer-mode-note').click()
      await expect(composer).toBeVisible()
      await expect(page.getByText('Remove attachments before switching to an internal note.')).toBeVisible()
      await page.getByTestId('support-composer-input').fill('Uploaded from the composer.')
      await page.getByTestId('support-composer-submit').click()
      await expect
        .poll(() => messageBody)
        .toEqual(expect.objectContaining({ attachments: [{ uploadId: expect.any(String) }] }))
      expect(JSON.stringify(messageBody)).not.toContain('storageKey')
      await expect(page.getByTestId('support-message-attachment-ui-attachment-1')).toHaveAttribute(
        'href',
        '/api/support/attachments/ui-attachment-1'
      )
      await expect(page.getByTestId('support-message-attachment-ui-attachment-1')).toHaveAttribute(
        'download',
        'contract.txt'
      )
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe(
          'The previous attempt may already have been accepted. Retrying could send a duplicate.'
        )
        await dialog.dismiss()
      })
      await page.getByTestId('support-message-retry').click()
      expect(deliveryRetryCount).toBe(0)
      await expect(page.getByTestId('support-message-delivery-failed')).toBeVisible()

      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe(
          'The previous attempt may already have been accepted. Retrying could send a duplicate.'
        )
        await dialog.accept()
      })
      await page.getByTestId('support-message-retry').click()
      await expect.poll(() => deliveryRetryCount).toBe(1)
      await page.getByTestId('support-composer-mode-note').click()
      await expect(page.locator('[data-testid="support-composer-note"]')).toBeVisible()
      await expect(page.getByTestId('support-composer-attach')).toBeHidden()
      await page.getByTestId('support-composer-mode-reply').click()
      await expect(composer).toBeVisible()

      await input.setInputFiles({ name: 'failed.txt', mimeType: 'text/plain', buffer: Buffer.from('failed') })
      await expect(page.locator('[data-phase="failed"]').first()).toBeVisible({ timeout: 10_000 })
      await page.locator('[data-phase="failed"] [data-testid$="-retry"]').click()
      await expect(page.locator('[data-phase="ready"]').last()).toBeVisible({ timeout: 10_000 })
      expect(directCompletionOrder).toEqual(['put', 'complete'])

      await input.setInputFiles({ name: 'expires.txt', mimeType: 'text/plain', buffer: Buffer.from('expires') })
      await expect(page.getByTestId('support-composer-expired-error')).toContainText(
        'This attachment expired. Remove it and upload the file again.',
        { timeout: 10_000 }
      )
      await expect(page.getByTestId('support-composer-submit')).toBeDisabled()
      await page.locator('[data-phase="expired"] [data-testid$="-remove"]').click()
      await input.setInputFiles({ name: 'recovered.txt', mimeType: 'text/plain', buffer: Buffer.from('recovered') })
      await expect(page.locator('[data-phase="ready"]').last()).toBeVisible({ timeout: 10_000 })
    } finally {
      if (conversationId) await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.email, customerEmail))
      if (inboxId) await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
      await db.delete(teamMember).where(eq(teamMember.id, teamMemberId))
      await db.delete(verification).where(eq(verification.identifier, adminCredentials.email))
      await db.delete(session).where(eq(session.userId, adminUserId))
      await db.delete(account).where(eq(account.userId, adminUserId))
      await db.delete(user).where(eq(user.id, adminUserId))
    }
  })
})
