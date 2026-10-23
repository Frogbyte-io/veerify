import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { ensureVerifiedSendingDomain } from './helpers/sending-domains'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'
import {
  cannedResponse,
  contact,
  conversation,
  supportInbox,
  supportInboxMember,
} from '../../server/database/schema/support'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function activeProjectAndUser(request: Parameters<typeof signInAndGetSessionCookie>[0]) {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/support')
  const [projectResponse, sessionResponse] = await Promise.all([
    request.get('/api/projects/active', { headers }),
    request.get('/api/auth/session', { headers }),
  ])
  expect(projectResponse.ok()).toBeTruthy()
  expect(sessionResponse.ok()).toBeTruthy()
  const sessionPayload = await sessionResponse.json()
  return {
    projectId: (await projectResponse.json()).data.id as string,
    userId: sessionPayload.data.user.id as string,
    userName: (sessionPayload.data.user.name || sessionPayload.data.user.email) as string,
  }
}

async function loginAndActivateProject(page: import('@playwright/test').Page, projectId: string) {
  const sessionCookie = await signInAndGetSessionCookie(page.request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const activeProjectResponse = await page.request.post('/api/projects/active', {
    headers: withAuthHeaders(sessionCookie, '/support'),
    data: { projectId },
  })
  if (!activeProjectResponse.ok()) {
    throw new Error(
      `Could not activate support project: ${activeProjectResponse.status()} ${await activeProjectResponse.text()}`
    )
  }
}

test.describe.serial('support canned responses', () => {
  test('an ordinary inbox agent can create, edit, and delete project canned responses', async ({ page, request }) => {
    const { projectId, userId } = await activeProjectAndUser(request)
    await ensureVerifiedSendingDomain(projectId)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `canned-crud-inbox-${suffix}`
    const membershipId = `canned-crud-member-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        projectId,
        name: `Canned CRUD ${suffix}`,
        slug: `canned-crud-${suffix}`,
        emailAddress: `canned-crud-${suffix}@example.com`,
        fromName: 'Canned CRUD E2E',
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(supportInboxMember).values({
        id: membershipId,
        inboxId,
        userId,
        role: 'agent',
        createdAt: now,
      })

      await loginAndActivateProject(page, projectId)
      await page.goto(`/support/settings?inboxId=${inboxId}`, { waitUntil: 'domcontentloaded' })

      const section = page.getByTestId('support-canned-responses')
      await expect(section).toBeVisible()

      await page.locator('#canned-response-shortcode').fill(`hello_${suffix}`)
      await page.locator('#canned-response-title').fill('Friendly greeting')
      await page.locator('#canned-response-body').fill('Hi {{contact.name}}, {{agent.name}} here.')

      const createResponse = page.waitForResponse(
        (response) => response.url().includes('/api/support/canned-responses') && response.request().method() === 'POST'
      )
      await page.getByTestId('support-canned-response-submit').click()
      expect((await createResponse).ok()).toBeTruthy()

      const row = page.getByTestId('support-canned-response-row').filter({ hasText: `/hello_${suffix}` })
      await expect(row).toContainText('Friendly greeting')
      await expect(row).toContainText('Hi {{contact.name}}, {{agent.name}} here.')

      await row.getByTestId('support-canned-response-edit').click()
      await page.locator('#canned-response-title').fill('Updated greeting')
      await page.locator('#canned-response-body').fill('Hello {{contact.name}}.')
      const updateResponse = page.waitForResponse(
        (response) => response.url().includes('/api/support/canned-responses/') && response.request().method() === 'PUT'
      )
      await page.getByTestId('support-canned-response-submit').click()
      expect((await updateResponse).ok()).toBeTruthy()
      await expect(row).toContainText('Updated greeting')
      await expect(row).toContainText('Hello {{contact.name}}.')

      const deleteResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/support/canned-responses/') && response.request().method() === 'DELETE'
      )
      await row.getByTestId('support-canned-response-delete').click()
      expect((await deleteResponse).ok()).toBeTruthy()
      await expect(row).toHaveCount(0)
    } finally {
      await db.delete(cannedResponse).where(eq(cannedResponse.projectId, projectId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('composer inserts a shortcode at the cursor with contact and agent substitution', async ({ page, request }) => {
    const { projectId, userId, userName } = await activeProjectAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `canned-compose-inbox-${suffix}`
    const membershipId = `canned-compose-member-${suffix}`
    const contactId = `canned-compose-contact-${suffix}`
    const conversationId = `canned-compose-conversation-${suffix}`
    const cannedResponseId = `canned-compose-response-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        projectId,
        name: `Canned Composer ${suffix}`,
        slug: `canned-compose-${suffix}`,
        emailAddress: `canned-compose-${suffix}@example.com`,
        fromName: 'Canned Composer E2E',
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(supportInboxMember).values({
        id: membershipId,
        inboxId,
        userId,
        role: 'agent',
        createdAt: now,
      })
      await db.insert(contact).values({
        id: contactId,
        projectId,
        name: 'Canned Customer',
        email: `canned-customer-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        projectId,
        contactId,
        displayId: 860000 + (Number.parseInt(suffix, 16) % 10000),
        subject: 'Canned response insertion',
        status: 'open',
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(cannedResponse).values({
        id: cannedResponseId,
        projectId,
        shortcode: `saved_${suffix}`,
        title: 'Saved reply',
        body: 'Hi {{contact.name}}, {{agent.name}} can help.',
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })

      await loginAndActivateProject(page, projectId)
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationId}`, {
        waitUntil: 'domcontentloaded',
      })

      const composer = page.getByTestId('support-composer-input')
      await expect(page.getByRole('heading', { name: 'Canned response insertion' })).toBeVisible()
      await composer.fill('Intro  thanks')
      await composer.evaluate((element) => {
        const input = element as HTMLTextAreaElement
        input.setSelectionRange(6, 6)
        input.dispatchEvent(new Event('select', { bubbles: true }))
      })

      await page.getByTestId('support-composer-canned-trigger').click()
      await page.getByTestId(`support-composer-canned-option-saved_${suffix}`).click()

      await expect(composer).toHaveValue(`Intro Hi Canned Customer, ${userName} can help. thanks`)
      await expect
        .poll(() => composer.evaluate((element) => (element as HTMLTextAreaElement).selectionStart))
        .toBe(`Intro Hi Canned Customer, ${userName} can help.`.length)

      await page.getByTestId('support-composer-mode-note').click()
      await expect(page.getByTestId('support-composer-note')).toBeVisible()
      await composer.fill('Note  internal')
      await composer.evaluate((element) => {
        const input = element as HTMLTextAreaElement
        input.setSelectionRange(5, 5)
        input.dispatchEvent(new Event('select', { bubbles: true }))
      })

      await page.getByTestId('support-composer-canned-trigger').click()
      await page.getByTestId(`support-composer-canned-option-saved_${suffix}`).click()

      await expect(composer).toHaveValue(`Note Hi Canned Customer, ${userName} can help. internal`)
    } finally {
      await db.delete(cannedResponse).where(inArray(cannedResponse.id, [cannedResponseId]))
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })
})
