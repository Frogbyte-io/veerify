import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportInbox, supportInboxMember } from '../../server/database/schema/support'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test('support inbox exposes four fixed views with Unassigned as the scoped landing view', async ({ page, request }) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/support')
  const teamResponse = await request.get('/api/teams/active', { headers })
  expect(teamResponse.ok()).toBeTruthy()
  const teamId = (await teamResponse.json()).data.id as string
  const sessionResponse = await request.get('/api/auth/session', { headers })
  expect(sessionResponse.ok()).toBeTruthy()
  const userId = (await sessionResponse.json()).data.user.id as string

  const suffix = randomUUID().slice(0, 8)
  const inboxId = `views-e2e-inbox-${suffix}`
  const membershipId = `views-e2e-member-${suffix}`
  const now = new Date()
  const displayIdBase = 810000 + (Number.parseInt(suffix, 16) % 10000) * 10
  const contactIds = ['unassigned', 'assigned', 'resolved', 'closed'].map(
    (kind) => `views-e2e-${kind}-contact-${suffix}`
  )
  const conversationRows = [
    {
      id: `views-e2e-unassigned-${suffix}`,
      contactId: contactIds[0],
      subject: 'Fixed views unassigned',
      status: 'open',
      assigneeUserId: null,
      displayId: displayIdBase,
    },
    {
      id: `views-e2e-assigned-${suffix}`,
      contactId: contactIds[1],
      subject: 'Fixed views assigned to me',
      status: 'open',
      assigneeUserId: userId,
      displayId: displayIdBase + 1,
    },
    {
      id: `views-e2e-resolved-${suffix}`,
      contactId: contactIds[2],
      subject: 'Fixed views resolved',
      status: 'resolved',
      assigneeUserId: userId,
      displayId: displayIdBase + 2,
    },
    {
      id: `views-e2e-closed-${suffix}`,
      contactId: contactIds[3],
      subject: 'Fixed views all only',
      status: 'closed',
      assigneeUserId: null,
      displayId: displayIdBase + 3,
    },
  ]

  try {
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: `Fixed views ${suffix}`,
      slug: `fixed-views-${suffix}`,
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
        name: `Fixed Views Customer ${index}`,
        email: `fixed-views-${index}-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(conversation).values(
      conversationRows.map((row, index) => ({
        ...row,
        inboxId,
        teamId,
        lastActivityAt: new Date(now.getTime() + index * 1000),
        lastCustomerReplyAt: new Date(now.getTime() + index * 1000),
        createdAt: new Date(now.getTime() + index * 1000),
        updatedAt: now,
      }))
    )

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto(`/support?inboxId=${inboxId}`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('support-view-unassigned')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('support-view-assigned-to-me')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('support-view-resolved')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('support-view-all')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('support-filter-status')).toHaveCount(0)
    await expect(page.getByTestId('support-filter-assignee')).toHaveCount(0)

    await expect(page.getByTestId(`support-conversation-${conversationRows[0].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[1].id}`)).toHaveCount(0)
    await expect(page.getByTestId(`support-conversation-${conversationRows[2].id}`)).toHaveCount(0)
    await expect(page.getByTestId(`support-conversation-${conversationRows[3].id}`)).toHaveCount(0)

    await page.getByTestId('support-view-assigned-to-me').click()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('assigned-to-me')
    expect(new URL(page.url()).searchParams.get('inboxId')).toBe(inboxId)
    await expect(page.getByTestId(`support-conversation-${conversationRows[1].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[0].id}`)).toHaveCount(0)

    await page.goto(`/support?inboxId=${inboxId}&view=resolved`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('support-view-resolved')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId(`support-conversation-${conversationRows[2].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[1].id}`)).toHaveCount(0)

    await page.getByTestId('support-view-all').click()
    await expect(page.getByTestId(`support-conversation-${conversationRows[0].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[1].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[2].id}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${conversationRows[3].id}`)).toBeVisible()
  } finally {
    await db.delete(conversation).where(
      inArray(
        conversation.id,
        conversationRows.map((row) => row.id)
      )
    )
    await db.delete(contact).where(inArray(contact.id, contactIds))
    await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
  }
})
