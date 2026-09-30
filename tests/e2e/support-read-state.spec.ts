import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportInbox, supportInboxMember } from '../../server/database/schema/support'
import { user } from '../../server/database/schema/auth'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.describe.serial('support conversation read state', () => {
  test('opening and manually flagging a conversation updates unread styling and the two queue badges', async ({
    page,
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie, '/support')
    const teamResponse = await request.get('/api/teams/active', { headers })
    expect(teamResponse.ok()).toBeTruthy()
    const teamId = (await teamResponse.json()).data.id as string
    const sessionResponse = await request.get('/api/auth/session', { headers })
    expect(sessionResponse.ok()).toBeTruthy()
    const userId = (await sessionResponse.json()).data.user.id as string

    const suffix = randomUUID().slice(0, 8)
    const inboxId = `read-e2e-inbox-${suffix}`
    const membershipId = `read-e2e-member-${suffix}`
    const contactId = `read-e2e-contact-${suffix}`
    const conversationId = `read-e2e-conversation-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Read state ${suffix}`,
        slug: `read-state-${suffix}`,
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
        teamId,
        name: 'Unread Customer',
        email: `unread-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        teamId,
        contactId,
        displayId: 800000 + (Number.parseInt(suffix, 16) % 100000),
        subject: 'Unread styling check',
        status: 'open',
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}`, { waitUntil: 'domcontentloaded' })

      const row = page.getByTestId(`support-conversation-${conversationId}`)
      await expect(row).toHaveAttribute('data-unread', 'true')
      await expect(row.getByText('Unread styling check')).toHaveClass(/font-semibold/)
      await expect(page.getByTestId('support-unread-unassigned')).toHaveText('1')
      await expect(page.getByTestId('support-unread-assigned-to-me')).toHaveText('0')

      const markReadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith(`/api/support/conversations/${conversationId}/read-state`)
      )
      await row.click()
      expect((await markReadResponse).ok()).toBeTruthy()
      await expect(row).toHaveAttribute('data-unread', 'false')
      await expect(page.getByTestId('support-unread-unassigned')).toHaveText('0')

      const markUnreadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith(`/api/support/conversations/${conversationId}/read-state`)
      )
      await page.getByTestId('support-thread-mark-unread').click()
      expect((await markUnreadResponse).ok()).toBeTruthy()
      await expect(row).toHaveAttribute('data-unread', 'true')
      await expect(page.getByTestId('support-unread-unassigned')).toHaveText('1')
    } finally {
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(inArray(supportInbox.id, [inboxId]))
    }
  })

  test('hides manual mark-unread and explains why for another agent’s handled conversation', async ({
    page,
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie, '/support')
    const teamResponse = await request.get('/api/teams/active', { headers })
    expect(teamResponse.ok()).toBeTruthy()
    const teamId = (await teamResponse.json()).data.id as string
    const sessionResponse = await request.get('/api/auth/session', { headers })
    expect(sessionResponse.ok()).toBeTruthy()
    const userId = (await sessionResponse.json()).data.user.id as string

    const suffix = randomUUID().slice(0, 8)
    const ownerUserId = `read-e2e-owner-${suffix}`
    const inboxId = `read-e2e-handled-inbox-${suffix}`
    const membershipId = `read-e2e-handled-member-${suffix}`
    const contactId = `read-e2e-handled-contact-${suffix}`
    const conversationId = `read-e2e-handled-conversation-${suffix}`
    const now = new Date()

    try {
      await db.insert(user).values({
        id: ownerUserId,
        name: 'Conversation owner',
        email: `read-e2e-owner-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Handled read state ${suffix}`,
        slug: `handled-read-state-${suffix}`,
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
        teamId,
        name: 'Handled Customer',
        email: `handled-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        teamId,
        contactId,
        assigneeUserId: ownerUserId,
        displayId: 900000 + (Number.parseInt(suffix, 16) % 100000),
        subject: 'Handled by another agent',
        status: 'open',
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all`, { waitUntil: 'domcontentloaded' })

      const row = page.getByTestId(`support-conversation-${conversationId}`)
      await expect(row).toHaveAttribute('data-unread', 'false')
      const markReadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith(`/api/support/conversations/${conversationId}/read-state`)
      )
      await row.click()
      expect((await markReadResponse).ok()).toBeTruthy()
      await expect(page.getByRole('heading', { name: 'Handled by another agent' })).toBeVisible()
      await expect(page.getByTestId('support-thread-mark-unread')).toHaveCount(0)
      await expect(page.getByTestId('support-thread-mark-unread-unavailable')).toHaveText(
        'This conversation is handled by another agent. Only its assignee can mark it unread.'
      )
    } finally {
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
      await db.delete(user).where(eq(user.id, ownerUserId))
    }
  })
})
