import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import {
  contact,
  conversation,
  conversationMessage,
  supportInbox,
  supportInboxMember,
} from '../../server/database/schema/support'
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

test.describe.serial('Stage 05A acceptance workflows', () => {
  test('a reply claims an unassigned conversation while an internal note leaves it unassigned', async ({
    page,
    request,
  }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `stage-05a-claim-inbox-${suffix}`
    const membershipId = `stage-05a-claim-member-${suffix}`
    const contactId = `stage-05a-claim-contact-${suffix}`
    const conversationId = `stage-05a-claim-conversation-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Stage 05A claim ${suffix}`,
        slug: `stage-05a-claim-${suffix}`,
        emailAddress: `stage-05a-claim-${suffix}@example.com`,
        fromName: 'Stage 05A E2E',
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
        name: `Stage 05A customer ${suffix}`,
        email: `stage-05a-customer-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        teamId,
        contactId,
        displayId: 880000 + (Number.parseInt(suffix, 16) % 10000),
        subject: `Stage 05A claim ${suffix}`,
        status: 'open',
        assigneeUserId: null,
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationId}`, {
        waitUntil: 'domcontentloaded',
      })

      const assignee = page.getByTestId('support-thread-assignee')
      const composer = page.getByTestId('support-composer-input')
      await expect(assignee).toHaveValue('')

      await page.getByTestId('support-composer-mode-note').click()
      await composer.fill('A private note must not claim this ticket.')
      const noteResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/support/conversations/${conversationId}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      expect((await noteResponse).ok()).toBeTruthy()
      await expect(assignee).toHaveValue('')

      const [afterNote] = await db
        .select({ assigneeUserId: conversation.assigneeUserId })
        .from(conversation)
        .where(eq(conversation.id, conversationId))
      expect(afterNote?.assigneeUserId).toBeNull()
      const afterNoteMessages = await db
        .select({ kind: conversationMessage.kind })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conversationId))
        .orderBy(asc(conversationMessage.createdAt))
      expect(afterNoteMessages.map(({ kind }) => kind)).toEqual(['note'])

      await page.getByTestId('support-composer-mode-reply').click()
      await composer.fill('A public reply claims this ticket for the replying agent.')
      const replyResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/support/conversations/${conversationId}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      expect((await replyResponse).ok()).toBeTruthy()
      await expect(assignee).toHaveValue(userId)

      const [persisted] = await db
        .select({ assigneeUserId: conversation.assigneeUserId })
        .from(conversation)
        .where(eq(conversation.id, conversationId))
      expect(persisted?.assigneeUserId).toBe(userId)
      const afterReplyMessages = await db
        .select({ kind: conversationMessage.kind })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conversationId))
        .orderBy(asc(conversationMessage.createdAt))
      expect(afterReplyMessages.map(({ kind }) => kind)).toEqual(['note', 'outgoing', 'activity'])
    } finally {
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('restores reply and internal-note drafts independently for the same conversation', async ({ page, request }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `stage-05a-draft-inbox-${suffix}`
    const membershipId = `stage-05a-draft-member-${suffix}`
    const contactIds = [`stage-05a-draft-contact-a-${suffix}`, `stage-05a-draft-contact-b-${suffix}`]
    const conversationIds = [`stage-05a-draft-conversation-a-${suffix}`, `stage-05a-draft-conversation-b-${suffix}`]
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Stage 05A drafts ${suffix}`,
        slug: `stage-05a-drafts-${suffix}`,
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
          name: `Stage 05A draft customer ${index + 1} ${suffix}`,
          email: `stage-05a-draft-${index + 1}-${suffix}@example.com`,
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
          displayId: 881000 + (Number.parseInt(suffix, 16) % 10000) * 10 + index,
          subject: index === 0 ? `Stage 05A draft primary ${suffix}` : `Stage 05A draft other ${suffix}`,
          status: 'open',
          lastActivityAt: new Date(now.getTime() + index * 1000),
          lastCustomerReplyAt: new Date(now.getTime() + index * 1000),
          createdAt: new Date(now.getTime() + index * 1000),
          updatedAt: now,
        }))
      )

      let releaseContactHistory: () => void = () => {}
      let contactHistoryRequested: () => void = () => {}
      const contactHistoryGate = new Promise<void>((resolve) => {
        releaseContactHistory = resolve
      })
      const contactHistoryStarted = new Promise<void>((resolve) => {
        contactHistoryRequested = resolve
      })
      await page.route(/\/api\/support\/conversations\?.*contactId=/, async (route) => {
        contactHistoryRequested()
        await contactHistoryGate
        await route.continue()
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationIds[0]}`, {
        waitUntil: 'domcontentloaded',
      })

      const primaryRow = page.getByTestId(`support-conversation-${conversationIds[0]}`)
      const otherRow = page.getByTestId(`support-conversation-${conversationIds[1]}`)
      const composer = page.getByTestId('support-composer-input')
      try {
        await contactHistoryStarted
        await expect(primaryRow).toBeVisible()
        await expect(otherRow).toBeVisible()
        await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      } finally {
        releaseContactHistory()
      }

      await composer.fill('Reply draft for the customer.')
      await page.getByTestId('support-composer-mode-note').click()
      await expect(page.getByTestId('support-composer-note')).toBeVisible()
      await composer.fill('Internal note draft for the team.')

      await otherRow.click()
      await expect(page.getByRole('heading', { name: `Stage 05A draft other ${suffix}` })).toBeVisible()
      await primaryRow.click()
      await expect(page.getByRole('heading', { name: `Stage 05A draft primary ${suffix}` })).toBeVisible()
      await expect(page.getByTestId('support-composer-note')).toBeVisible()
      await expect(composer).toHaveValue('Internal note draft for the team.')

      await page.getByTestId('support-composer-mode-reply').click()
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      await expect(composer).toHaveValue('Reply draft for the customer.')
    } finally {
      await db.delete(conversation).where(inArray(conversation.id, conversationIds))
      await db.delete(contact).where(inArray(contact.id, contactIds))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('global search finds a resolved conversation from another fixed view and keeps its deep link', async ({
    page,
    request,
  }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `stage-05a-search-inbox-${suffix}`
    const membershipId = `stage-05a-search-member-${suffix}`
    const contactIds = [`stage-05a-search-contact-resolved-${suffix}`, `stage-05a-search-contact-open-${suffix}`]
    const conversationIds = [`stage-05a-search-resolved-${suffix}`, `stage-05a-search-open-${suffix}`]
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Stage 05A search ${suffix}`,
        slug: `stage-05a-search-${suffix}`,
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
          name: `Stage 05A search customer ${index + 1} ${suffix}`,
          email: `stage-05a-search-${index + 1}-${suffix}@example.com`,
          createdAt: now,
          updatedAt: now,
        }))
      )
      await db.insert(conversation).values([
        {
          id: conversationIds[0],
          inboxId,
          teamId,
          contactId: contactIds[0],
          displayId: 882000 + (Number.parseInt(suffix, 16) % 10000),
          subject: `Stage 05A resolved target ${suffix}`,
          status: 'resolved',
          assigneeUserId: userId,
          lastActivityAt: now,
          lastCustomerReplyAt: now,
          lastAgentReplyAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: conversationIds[1],
          inboxId,
          teamId,
          contactId: contactIds[1],
          displayId: 882001 + (Number.parseInt(suffix, 16) % 10000),
          subject: `Stage 05A open ticket ${suffix}`,
          status: 'open',
          assigneeUserId: null,
          lastActivityAt: new Date(now.getTime() - 1000),
          lastCustomerReplyAt: new Date(now.getTime() - 1000),
          createdAt: new Date(now.getTime() - 1000),
          updatedAt: now,
        },
      ])

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=assigned-to-me`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('support-view-assigned-to-me')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId(`support-conversation-${conversationIds[0]}`)).toHaveCount(0)

      const searchInput = page.getByTestId('support-conversation-search')
      await searchInput.fill(`Stage 05A resolved target ${suffix}`)
      await expect(page.getByTestId(`support-conversation-${conversationIds[0]}`)).toBeVisible()
      await expect(page.getByTestId(`support-conversation-${conversationIds[1]}`)).toHaveCount(0)

      await page.getByTestId(`support-conversation-${conversationIds[0]}`).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('conversationId')).toBe(conversationIds[0])
      expect(new URL(page.url()).searchParams.get('view')).toBe('assigned-to-me')
      expect(new URL(page.url()).searchParams.get('search')).toContain(suffix)
      await expect(page.getByRole('heading', { name: `Stage 05A resolved target ${suffix}` })).toBeVisible()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: `Stage 05A resolved target ${suffix}` })).toBeVisible()
      await expect.poll(() => new URL(page.url()).searchParams.get('conversationId')).toBe(conversationIds[0])
      expect(new URL(page.url()).searchParams.get('search')).toBe(`Stage 05A resolved target ${suffix}`)
      expect(new URL(page.url()).searchParams.get('view')).toBe('assigned-to-me')
      await expect(page.getByTestId('support-view-assigned-to-me')).toHaveAttribute('aria-pressed', 'true')
      await expect(searchInput).toHaveValue(`Stage 05A resolved target ${suffix}`)
      await expect(page.getByTestId(`support-conversation-${conversationIds[0]}`)).toBeVisible()
      await expect(page.getByTestId(`support-conversation-${conversationIds[1]}`)).toHaveCount(0)
    } finally {
      await db.delete(conversation).where(inArray(conversation.id, conversationIds))
      await db.delete(contact).where(inArray(contact.id, contactIds))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })
})
