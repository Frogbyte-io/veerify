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

test.describe.serial('support local drafts', () => {
  test('reply and note drafts coexist and restore the last edited composer mode', async ({ page, request }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `draft-e2e-inbox-${suffix}`
    const membershipId = `draft-e2e-member-${suffix}`
    const contactIds = [`draft-e2e-contact-a-${suffix}`, `draft-e2e-contact-b-${suffix}`]
    const conversationIds = [`draft-e2e-conversation-a-${suffix}`, `draft-e2e-conversation-b-${suffix}`]
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Drafts ${suffix}`,
        slug: `drafts-${suffix}`,
        emailAddress: `drafts-${suffix}@example.com`,
        fromName: 'Drafts E2E',
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
          name: `Draft Customer ${index + 1}`,
          email: `draft-customer-${index + 1}-${suffix}@example.com`,
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
          displayId: 830000 + (Number.parseInt(suffix, 16) % 10000) * 10 + index,
          subject: index === 0 ? 'Draft restore primary' : 'Draft restore secondary',
          status: 'open',
          lastActivityAt: new Date(now.getTime() + index * 1000),
          lastCustomerReplyAt: new Date(now.getTime() + index * 1000),
          createdAt: new Date(now.getTime() + index * 1000),
          updatedAt: now,
        }))
      )

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationIds[0]}`, {
        waitUntil: 'domcontentloaded',
      })

      const primaryRow = page.getByTestId(`support-conversation-${conversationIds[0]}`)
      const secondaryRow = page.getByTestId(`support-conversation-${conversationIds[1]}`)
      const composer = page.getByTestId('support-composer-input')
      await expect(primaryRow).toBeVisible()
      await expect(primaryRow).toHaveAttribute('data-has-draft', 'false')
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()

      await composer.fill('Reply draft survives separately.')
      await expect(primaryRow).toHaveAttribute('data-has-draft', 'true')
      await expect(primaryRow.getByTestId('support-conversation-draft-indicator')).toBeVisible()

      await page.getByTestId('support-composer-mode-note').click()
      await expect(page.getByTestId('support-composer-note')).toBeVisible()
      await expect(composer).toHaveValue('')
      await composer.fill('Note draft stays private.')

      await secondaryRow.click()
      await expect(page.getByRole('heading', { name: 'Draft restore secondary' })).toBeVisible()
      await expect(primaryRow).toHaveAttribute('data-has-draft', 'true')

      await primaryRow.click()
      await expect(page.getByRole('heading', { name: 'Draft restore primary' })).toBeVisible()
      await expect(page.getByTestId('support-composer-note')).toBeVisible()
      await expect(composer).toHaveValue('Note draft stays private.')

      await page.getByTestId('support-composer-mode-reply').click()
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      await expect(composer).toHaveValue('Reply draft survives separately.')
    } finally {
      await db.delete(conversation).where(inArray(conversation.id, conversationIds))
      await db.delete(contact).where(inArray(contact.id, contactIds))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('successful send clears only the matching draft and updates the row indicator', async ({ page, request }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `draft-send-e2e-inbox-${suffix}`
    const membershipId = `draft-send-e2e-member-${suffix}`
    const contactId = `draft-send-e2e-contact-${suffix}`
    const conversationId = `draft-send-e2e-conversation-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Draft send ${suffix}`,
        slug: `draft-send-${suffix}`,
        emailAddress: `draft-send-${suffix}@example.com`,
        fromName: 'Draft Send E2E',
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
        name: 'Draft Send Customer',
        email: `draft-send-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        teamId,
        contactId,
        displayId: 840000 + (Number.parseInt(suffix, 16) % 10000),
        subject: 'Draft send clearing',
        status: 'open',
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationId}`, {
        waitUntil: 'domcontentloaded',
      })

      const row = page.getByTestId(`support-conversation-${conversationId}`)
      const composer = page.getByTestId('support-composer-input')
      await expect(row).toHaveAttribute('data-has-draft', 'false')

      await composer.fill('Reply draft should remain after note send.')
      await page.getByTestId('support-composer-mode-note').click()
      await composer.fill('Note draft should clear after note send.')
      await expect(row).toHaveAttribute('data-has-draft', 'true')

      const noteResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/support/conversations/${conversationId}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      expect((await noteResponse).ok()).toBeTruthy()
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      await expect(composer).toHaveValue('Reply draft should remain after note send.')
      await expect(row).toHaveAttribute('data-has-draft', 'true')

      const replyResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/support/conversations/${conversationId}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      expect((await replyResponse).ok()).toBeTruthy()
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      await expect(composer).toHaveValue('')
      await expect(row).toHaveAttribute('data-has-draft', 'false')
      await expect(row.getByTestId('support-conversation-draft-indicator')).toHaveCount(0)
    } finally {
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('delayed successful send clears the submitted conversation draft without mutating the new composer', async ({
    page,
    request,
  }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `draft-stale-e2e-inbox-${suffix}`
    const membershipId = `draft-stale-e2e-member-${suffix}`
    const contactIds = [`draft-stale-e2e-contact-a-${suffix}`, `draft-stale-e2e-contact-b-${suffix}`]
    const conversationIds = [`draft-stale-e2e-conversation-a-${suffix}`, `draft-stale-e2e-conversation-b-${suffix}`]
    const now = new Date()
    let releasePost: (() => void) | null = null
    const releaseDelayedPost = () => {
      if (!releasePost) throw new Error('Delayed message POST was not intercepted')
      releasePost()
    }

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Draft stale ${suffix}`,
        slug: `draft-stale-${suffix}`,
        emailAddress: `draft-stale-${suffix}@example.com`,
        fromName: 'Draft Stale E2E',
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
          name: `Draft Stale Customer ${index + 1}`,
          email: `draft-stale-customer-${index + 1}-${suffix}@example.com`,
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
          displayId: 850000 + (Number.parseInt(suffix, 16) % 10000) * 10 + index,
          subject: index === 0 ? 'Delayed draft sender' : 'Delayed draft destination',
          status: 'open',
          lastActivityAt: new Date(now.getTime() + index * 1000),
          lastCustomerReplyAt: new Date(now.getTime() + index * 1000),
          createdAt: new Date(now.getTime() + index * 1000),
          updatedAt: now,
        }))
      )

      await page.route(`**/api/support/conversations/${conversationIds[0]}/messages`, async (route) => {
        await new Promise<void>((resolve) => {
          releasePost = resolve
        })
        await route.continue()
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationIds[0]}`, {
        waitUntil: 'domcontentloaded',
      })

      const submittedRow = page.getByTestId(`support-conversation-${conversationIds[0]}`)
      const destinationRow = page.getByTestId(`support-conversation-${conversationIds[1]}`)
      const composer = page.getByTestId('support-composer-input')

      await expect(submittedRow).toHaveAttribute('data-has-draft', 'false')
      await composer.fill('This reply is waiting on the network.')
      await expect(submittedRow).toHaveAttribute('data-has-draft', 'true')

      const delayedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/support/conversations/${conversationIds[0]}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      await expect(page.getByTestId('support-composer-submit')).toBeDisabled()

      await destinationRow.click()
      await expect(page.getByRole('heading', { name: 'Delayed draft destination' })).toBeVisible()
      await composer.fill('Destination draft must not be overwritten.')
      releaseDelayedPost()
      expect((await delayedResponse).ok()).toBeTruthy()

      await expect(submittedRow).toHaveAttribute('data-has-draft', 'false')
      await expect(destinationRow).toHaveAttribute('data-has-draft', 'true')
      await expect(page.getByTestId('support-composer-reply')).toBeVisible()
      await expect(composer).toHaveValue('Destination draft must not be overwritten.')
    } finally {
      await page.unroute(`**/api/support/conversations/${conversationIds[0]}/messages`).catch(() => {})
      await db.delete(conversation).where(inArray(conversation.id, conversationIds))
      await db.delete(contact).where(inArray(contact.id, contactIds))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })

  test('failed send keeps the draft and row indicator', async ({ page, request }) => {
    const { teamId, userId } = await activeTeamAndUser(request)
    const suffix = randomUUID().slice(0, 8)
    const inboxId = `draft-fail-e2e-inbox-${suffix}`
    const membershipId = `draft-fail-e2e-member-${suffix}`
    const contactId = `draft-fail-e2e-contact-${suffix}`
    const conversationId = `draft-fail-e2e-conversation-${suffix}`
    const now = new Date()

    try {
      await db.insert(supportInbox).values({
        id: inboxId,
        teamId,
        name: `Draft fail ${suffix}`,
        slug: `draft-fail-${suffix}`,
        emailAddress: `draft-fail-${suffix}@example.com`,
        fromName: 'Draft Fail E2E',
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
        name: 'Draft Failure Customer',
        email: `draft-fail-${suffix}@example.com`,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(conversation).values({
        id: conversationId,
        inboxId,
        teamId,
        contactId,
        displayId: 860000 + (Number.parseInt(suffix, 16) % 10000),
        subject: 'Draft failed send',
        status: 'open',
        lastActivityAt: now,
        lastCustomerReplyAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await page.route(`**/api/support/conversations/${conversationId}/messages`, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ data: { error: { message: 'Injected failure' } } }),
        })
      })

      await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
      await page.goto(`/support?inboxId=${inboxId}&view=all&conversationId=${conversationId}`, {
        waitUntil: 'domcontentloaded',
      })

      const row = page.getByTestId(`support-conversation-${conversationId}`)
      const composer = page.getByTestId('support-composer-input')
      await composer.fill('This draft should survive a failed send.')
      await expect(row).toHaveAttribute('data-has-draft', 'true')

      const failedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes(`/api/support/conversations/${conversationId}/messages`)
      )
      await page.getByTestId('support-composer-submit').click()
      expect((await failedResponse).status()).toBe(500)

      await expect(composer).toHaveValue('This draft should survive a failed send.')
      await expect(row).toHaveAttribute('data-has-draft', 'true')
      await expect(row.getByTestId('support-conversation-draft-indicator')).toBeVisible()
    } finally {
      await page.unroute(`**/api/support/conversations/${conversationId}/messages`).catch(() => {})
      await db.delete(conversation).where(eq(conversation.id, conversationId))
      await db.delete(contact).where(eq(contact.id, contactId))
      await db.delete(supportInboxMember).where(eq(supportInboxMember.id, membershipId))
      await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    }
  })
})
