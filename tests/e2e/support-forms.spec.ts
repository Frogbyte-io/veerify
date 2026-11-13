import { enableProjectSupport } from './helpers/support-project'
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { ensureVerifiedSendingDomain } from './helpers/sending-domains'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'
import { projectApiKey } from '../../server/database/schema/feedback'
import {
  contact,
  conversation,
  supportForm,
  supportInbox,
  supportOutboundDelivery,
  conversationMessage,
} from '../../server/database/schema/support'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(90_000)

/**
 * Website forms end to end: an admin builds a form and a server key in Inbox
 * settings, a site submits through the server API, the submission shows up in
 * the inbox laid out as fields, and an agent reply is queued to the
 * submitter's email.
 */
test('a form built in settings files submissions into the inbox and replies reach the submitter', async ({
  page,
  request,
}) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/inbox')
  const activeResponse = await request.get('/api/projects/active', { headers })
  expect(activeResponse.ok()).toBeTruthy()
  const active = (await activeResponse.json()).data.project as { id: string; slug: string }
  await enableProjectSupport(active.id)
  await ensureVerifiedSendingDomain(active.id)

  const suffix = randomUUID().slice(0, 8)
  const formName = `Shop contact ${suffix}`
  const formSlug = `shop-contact-${suffix}`
  const customerEmail = `form-customer-${suffix}@example.com`
  let inboxId: string | null = null
  let createdKeyPrefix: string | null = null

  try {
    const inboxResponse = await request.post('/api/support/inboxes', {
      headers,
      data: { projectId: active.id, name: `Forms ${suffix}`, slug: `forms-${suffix}` },
    })
    expect(inboxResponse.ok()).toBeTruthy()
    inboxId = (await inboxResponse.json()).data.inbox.id as string
    const inboxUpdate = await request.put(`/api/support/inboxes/${inboxId}`, {
      headers,
      data: { emailAddress: `forms-${suffix}@example.com`, fromName: 'Shop Support' },
    })
    expect(inboxUpdate.ok()).toBeTruthy()

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.request.post('/api/projects/active', {
      headers: withOriginHeaders('/inbox'),
      data: { projectId: active.id },
    })
    await page.goto('/inbox/settings#forms', { waitUntil: 'domcontentloaded' })

    // --- Build the form ------------------------------------------------------
    const forms = page.getByTestId('support-forms-settings')
    await expect(forms).toBeVisible()
    await forms.getByTestId('support-form-new').click()
    const editor = forms.getByTestId('support-form-editor')
    await editor.getByTestId('support-form-preset').click()
    await editor.locator('#support-form-name').fill(formName)
    await expect(editor.locator('#support-form-slug')).toHaveValue(formSlug)
    await editor.locator('#support-form-inbox').selectOption(inboxId)
    await expect(editor.getByTestId('support-form-field-row')).toHaveCount(4)

    // A checkbox, to see the builder's own field type round-trip.
    await editor.getByTestId('support-form-add-field').click()
    const added = editor.getByTestId('support-form-field-row').nth(4)
    await added.locator('input[id^="support-form-field-label-"]').fill('Order number')
    await expect(added.locator('input[id^="support-form-field-key-"]')).toHaveValue('order_number')

    // Browser submissions need an origin: the save is refused until one is given.
    await editor.locator('#support-form-browser').click()
    await editor.getByTestId('support-form-save').click()
    await expect(editor.getByTestId('support-form-errors')).toContainText('allowed origin')
    await editor.locator('#support-form-origins').fill('https://shop.example.com')
    await editor.getByTestId('support-form-save').click()

    const row = forms.locator(`[data-testid="support-form-row"][data-form-slug="${formSlug}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(formName)
    await expect(row).toContainText('5 fields')
    await row.getByTestId(`support-form-usage-${formSlug}`).click()
    await expect(row.getByTestId('support-form-usage-server')).toContainText(`/api/v1/forms/${formSlug}/submissions`)

    // --- Create a server key -------------------------------------------------
    await forms.getByTestId('support-form-key-create').click()
    await page.locator('#support-form-key-name').fill(`E2E shop ${suffix}`)
    await page.getByTestId('support-form-key-create-confirm').click()
    const serverKey = (await page.getByTestId('support-form-key-value').innerText()).trim()
    expect(serverKey.startsWith('vfy_srv_')).toBe(true)
    createdKeyPrefix = serverKey.slice(0, 12)
    await page.getByTestId('support-form-key-done').click()
    await expect(forms.getByTestId('support-form-key-row').filter({ hasText: `E2E shop ${suffix}` })).toBeVisible()

    // --- The site submits ----------------------------------------------------
    const submission = await request.post(`/api/v1/forms/${formSlug}/submissions`, {
      headers: { Authorization: `Bearer ${serverKey}`, 'Idempotency-Key': `e2e-${suffix}` },
      data: {
        fields: {
          name: 'Ola Nordmann',
          email: customerEmail,
          subject: 'support',
          message: 'The <b>display</b> flickers.\nSince the last update.',
          order_number: 'DML-1042',
        },
        metadata: { pageUrl: 'https://shop.example.com/contact', locale: 'nb-NO', brand: 'dotmatrixlabs' },
      },
    })
    expect(submission.status()).toBe(201)
    const { id: submissionId, conversationId } = (await submission.json()).data as {
      id: string
      conversationId: string
    }
    expect(submissionId).toBeTruthy()

    const retry = await request.post(`/api/v1/forms/${formSlug}/submissions`, {
      headers: { Authorization: `Bearer ${serverKey}`, 'Idempotency-Key': `e2e-${suffix}` },
      data: {
        fields: {
          name: 'Ola Nordmann',
          email: customerEmail,
          subject: 'support',
          message: 'The <b>display</b> flickers.\nSince the last update.',
          order_number: 'DML-1042',
        },
        metadata: { pageUrl: 'https://shop.example.com/contact', locale: 'nb-NO', brand: 'dotmatrixlabs' },
      },
    })
    expect(retry.status()).toBe(200)
    expect((await retry.json()).data.conversationId).toBe(conversationId)

    // --- It shows up in the inbox as a form submission ----------------------
    await page.goto(`/inbox?inboxId=${inboxId}&conversationId=${conversationId}`, { waitUntil: 'domcontentloaded' })
    const card = page.getByTestId('support-message-form')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('support-message-form-name')).toHaveText(`Form: ${formName}`)
    const fieldRows = card.getByTestId('support-message-form-field')
    await expect(fieldRows).toHaveCount(5)
    await expect(fieldRows.nth(2)).toContainText('Technical support')
    // Submitted markup is shown as text, never rendered.
    await expect(fieldRows.nth(3)).toContainText('The <b>display</b> flickers.')
    await expect(card.locator('b')).toHaveCount(0)
    await card.getByTestId('support-message-form-metadata').locator('summary').click()
    await expect(card.getByTestId('support-message-form-metadata')).toContainText('https://shop.example.com/contact')
    await expect(card.getByTestId('support-message-form-metadata')).toContainText('dotmatrixlabs')

    // --- An agent reply goes to the submitter -------------------------------
    const reply = await request.post(`/api/support/conversations/${conversationId}/messages`, {
      headers,
      data: { kind: 'outgoing', body: 'Thanks Ola, a fix ships next week.' },
    })
    expect(reply.ok()).toBeTruthy()
    const replyMessage = (await reply.json()).data.message as { id: string; inReplyTo: string | null }
    expect(replyMessage.inReplyTo).toBe(`form-${submissionId}@example.com`)
    const [delivery] = await db
      .select({ payload: supportOutboundDelivery.payload })
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, replyMessage.id))
    expect(delivery.payload.to).toBe(customerEmail)
  } finally {
    if (inboxId) {
      const rows = await db.select({ id: conversation.id }).from(conversation).where(eq(conversation.inboxId, inboxId))
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id)
        const messages = await db
          .select({ id: conversationMessage.id })
          .from(conversationMessage)
          .where(inArray(conversationMessage.conversationId, ids))
        if (messages.length > 0) {
          await db.delete(supportOutboundDelivery).where(
            inArray(
              supportOutboundDelivery.messageId,
              messages.map((m) => m.id)
            )
          )
        }
        await db.delete(conversation).where(inArray(conversation.id, ids))
      }
      await db.delete(supportForm).where(eq(supportForm.inboxId, inboxId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
    if (createdKeyPrefix) await db.delete(projectApiKey).where(eq(projectApiKey.keyPrefix, createdKeyPrefix))
    await db.delete(contact).where(eq(contact.email, customerEmail))
  }
})
