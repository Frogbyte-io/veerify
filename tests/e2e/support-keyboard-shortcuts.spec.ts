import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportInbox, supportInboxMember } from '../../server/database/schema/support'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function activeTeamAndUser(request: Parameters<typeof signInAndGetSessionCookie>[0]) {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/support')
  const [teamResponse, sessionResponse] = await Promise.all([
    request.get('/api/teams/active', { headers }),
    request.get('/api/auth/session', { headers }),
  ])
  expect(teamResponse.ok()).toBeTruthy()
  expect(sessionResponse.ok()).toBeTruthy()
  return {
    teamId: (await teamResponse.json()).data.id as string,
    userId: (await sessionResponse.json()).data.user.id as string,
  }
}

test('support keyboard shortcuts drive the visible list and ignore focused form controls', async ({
  page,
  request,
}) => {
  const { teamId, userId } = await activeTeamAndUser(request)
  const suffix = randomUUID().slice(0, 8)
  const inboxId = `shortcut-e2e-inbox-${suffix}`
  const membershipId = `shortcut-e2e-member-${suffix}`
  const contactIds = [`shortcut-e2e-contact-a-${suffix}`, `shortcut-e2e-contact-b-${suffix}`]
  const conversationIds = [`shortcut-e2e-conversation-a-${suffix}`, `shortcut-e2e-conversation-b-${suffix}`]
  const now = new Date()

  try {
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: `Shortcuts ${suffix}`,
      slug: `shortcuts-${suffix}`,
      emailAddress: `shortcuts-${suffix}@example.com`,
      fromName: 'Shortcuts E2E',
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
    await db.insert(contact).values(
      contactIds.map((id, index) => ({
        id,
        teamId,
        name: `Shortcut Customer ${index + 1}`,
        email: `shortcut-customer-${index + 1}-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(conversation).values(
      conversationIds.map((id, index) => ({
        id,
        inboxId,
        teamId,
        contactId: contactIds[index],
        displayId: 880000 + (Number.parseInt(suffix, 16) % 10000) * 10 + index,
        subject: index === 0 ? 'Shortcut first visible' : 'Shortcut second visible',
        status: 'open',
        assigneeUserId: null,
        lastActivityAt: new Date(now.getTime() - index * 1000),
        lastCustomerReplyAt: new Date(now.getTime() - index * 1000),
        createdAt: new Date(now.getTime() - index * 1000),
        updatedAt: now,
      }))
    )

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto(`/support?inboxId=${inboxId}&view=all`, { waitUntil: 'domcontentloaded' })

    const firstRow = page.getByTestId(`support-conversation-${conversationIds[0]}`)
    const secondRow = page.getByTestId(`support-conversation-${conversationIds[1]}`)
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()

    await page.keyboard.press('j')
    await expect(firstRow).toHaveClass(/bg-accent/)
    await expect(page.getByRole('heading', { name: 'Shortcut first visible' })).toBeVisible()

    await page.keyboard.press('j')
    await expect(secondRow).toHaveClass(/bg-accent/)
    await expect(page.getByRole('heading', { name: 'Shortcut second visible' })).toBeVisible()

    await page.keyboard.press('k')
    await expect(firstRow).toHaveClass(/bg-accent/)
    await expect(page.getByRole('heading', { name: 'Shortcut first visible' })).toBeVisible()
    await expect(page.getByTestId('support-composer-input')).toBeVisible()

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('n')
    await expect(page.getByTestId('support-composer-note')).toBeVisible()

    // Mode shortcuts focus the composer so typing can continue immediately;
    // blur it before asserting the next global shortcut.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('r')
    await expect(page.getByTestId('support-composer-reply')).toBeVisible()

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const claimResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/support/conversations/${conversationIds[0]}/claim`)
    )
    await page.keyboard.press('c')
    expect((await claimResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('support-thread-assignee')).toHaveValue(userId)
    // Claim also refreshes the thread and list before another update is
    // accepted. Waiting for the control avoids dropping the next shortcut.
    await expect(page.getByTestId('support-thread-status')).toBeEnabled()

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const resolveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/support/conversations/${conversationIds[0]}`)
    )
    await page.keyboard.press('e')
    expect((await resolveResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('support-thread-status')).toHaveValue('resolved')

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('/')
    const searchInput = page.getByTestId('support-conversation-search')
    await expect(searchInput).toBeFocused()
    await searchInput.fill(`Shortcut second ${suffix}`)
    await expect(secondRow).toBeVisible()

    await page.keyboard.press('j')
    await expect(searchInput).toHaveValue(`Shortcut second ${suffix}j`)
    await expect(firstRow).toHaveClass(/bg-accent/)

    await searchInput.blur()
    await page.keyboard.press('?')
    await expect(page.getByTestId('support-shortcut-help')).toBeVisible()
    await expect(page.getByText('j / k')).toBeVisible()
    await page.keyboard.press('?')
    await expect(page.getByTestId('support-shortcut-help')).toHaveCount(0)

    const composer = page.getByTestId('support-composer-input')
    await composer.focus()
    await page.keyboard.press('n')
    await expect(composer).toHaveValue('n')
    await expect(page.getByTestId('support-composer-reply')).toBeVisible()
    await page.keyboard.press('?')
    await expect(composer).toHaveValue('n?')
    await expect(page.getByTestId('support-shortcut-help')).toHaveCount(0)
  } finally {
    await db.delete(conversation).where(inArray(conversation.id, conversationIds))
    await db.delete(contact).where(inArray(contact.id, contactIds))
    await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
  }
})
