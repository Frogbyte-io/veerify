import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import {
  contact,
  conversation,
  csatResponse,
  csatSurvey,
  supportInbox,
  supportInboxMember,
} from '../../server/database/schema/support'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test('support search finds a resolved conversation from Unassigned by email and ticket number', async ({
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
  const inboxId = `search-e2e-inbox-${suffix}`
  const otherInboxId = `search-e2e-other-inbox-${suffix}`
  const now = new Date()
  const displayId = 870000 + (Number.parseInt(suffix, 16) % 10000)
  const resolvedContactId = `search-e2e-resolved-contact-${suffix}`
  const openContactId = `search-e2e-open-contact-${suffix}`
  const otherContactId = `search-e2e-other-contact-${suffix}`
  const resolvedConversationId = `search-e2e-resolved-${suffix}`
  const openConversationId = `search-e2e-open-${suffix}`
  const otherConversationId = `search-e2e-other-${suffix}`
  const customerEmail = `search-resolved-${suffix}@example.com`
  const surveyId = `search-e2e-survey-${suffix}`

  try {
    await db.insert(supportInbox).values([
      {
        id: inboxId,
        teamId,
        name: `Search ${suffix}`,
        slug: `search-${suffix}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherInboxId,
        teamId,
        name: `Search other ${suffix}`,
        slug: `search-other-${suffix}`,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(supportInboxMember).values([
      {
        id: `search-e2e-member-${suffix}`,
        inboxId,
        userId,
        role: 'agent',
        createdAt: now,
      },
      {
        id: `search-e2e-other-member-${suffix}`,
        inboxId: otherInboxId,
        userId,
        role: 'agent',
        createdAt: now,
      },
    ])
    await db.insert(contact).values([
      {
        id: resolvedContactId,
        teamId,
        name: `Search Resolved ${suffix}`,
        email: customerEmail,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: openContactId,
        teamId,
        name: `Search Open ${suffix}`,
        email: `search-open-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherContactId,
        teamId,
        name: `Search Other ${suffix}`,
        email: `search-other-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(conversation).values([
      {
        id: resolvedConversationId,
        inboxId,
        teamId,
        contactId: resolvedContactId,
        displayId,
        subject: `Resolved search target ${suffix}`,
        status: 'resolved',
        assigneeUserId: userId,
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        lastAgentReplyAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: openConversationId,
        inboxId,
        teamId,
        contactId: openContactId,
        displayId: displayId + 1,
        subject: `Visible unassigned ${suffix}`,
        status: 'open',
        assigneeUserId: null,
        lastActivityAt: new Date(now.getTime() - 1000),
        lastCustomerReplyAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 1000),
        updatedAt: now,
      },
      {
        id: otherConversationId,
        inboxId: otherInboxId,
        teamId,
        contactId: otherContactId,
        displayId: displayId + 2,
        subject: `Other inbox search target ${suffix}`,
        status: 'resolved',
        assigneeUserId: userId,
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        lastAgentReplyAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(csatSurvey).values({
      id: surveyId,
      teamId,
      inboxId,
      name: `Search CSAT ${suffix}`,
      scale: 'csat_5',
      question: 'How was the support experience?',
      sendTrigger: 'on_resolve',
      isEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(csatResponse).values({
      id: `search-e2e-response-${suffix}`,
      surveyId,
      conversationId: resolvedConversationId,
      contactId: resolvedContactId,
      agentUserId: userId,
      rating: 5,
      token: `search-e2e-token-${suffix}`,
      sentAt: now,
      respondedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto(`/support?inboxId=${inboxId}&search=${encodeURIComponent(customerEmail)}`, {
      waitUntil: 'domcontentloaded',
    })

    await expect(page.getByTestId('support-view-unassigned')).toHaveAttribute('aria-pressed', 'true')
    const searchInput = page.getByTestId('support-conversation-search')
    await expect(searchInput).toHaveValue(customerEmail)
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${otherConversationId}`)).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('inboxId')).toBe(inboxId)

    await page.getByTestId('support-conversation-search-clear').click()
    await expect(page.getByTestId(`support-conversation-${openConversationId}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('search')).toBeNull()
    await expect(page.getByTestId('support-view-unassigned')).toHaveAttribute('aria-pressed', 'true')

    await searchInput.fill(String(displayId))
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toBeVisible()
    await expect(page.getByTestId(`support-conversation-${otherConversationId}`)).toHaveCount(0)

    await page.getByTestId(`support-conversation-${resolvedConversationId}`).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('conversationId')).toBe(resolvedConversationId)
    expect(new URL(page.url()).searchParams.get('search')).toBe(String(displayId))

    await page.getByTestId('support-conversation-search-clear').click()
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBeNull()
    expect(new URL(page.url()).searchParams.get('conversationId')).toBe(resolvedConversationId)
    await expect(page.getByTestId('support-view-unassigned')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('support-view-resolved').click()
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toBeVisible()
    await page.getByTestId('support-csat-filter').selectOption('rated')
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toBeVisible()
    await expect(
      page.getByTestId(`support-conversation-${resolvedConversationId}`).getByTestId('support-conversation-csat')
    ).toHaveText('5')
    expect(new URL(page.url()).searchParams.get('csat')).toBe('rated')
    await page.getByTestId('support-csat-filter').selectOption('unrated')
    await expect(page.getByTestId(`support-conversation-${resolvedConversationId}`)).toHaveCount(0)
  } finally {
    await db
      .delete(conversation)
      .where(inArray(conversation.id, [resolvedConversationId, openConversationId, otherConversationId]))
    await db.delete(contact).where(inArray(contact.id, [resolvedContactId, openContactId, otherContactId]))
    await db
      .delete(supportInboxMember)
      .where(inArray(supportInboxMember.id, [`search-e2e-member-${suffix}`, `search-e2e-other-member-${suffix}`]))
    await db.delete(supportInbox).where(inArray(supportInbox.id, [inboxId, otherInboxId]))
  }
})
