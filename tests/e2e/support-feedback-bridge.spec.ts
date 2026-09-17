import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './helpers/db'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'
import { feedback, project } from '../../server/database/schema/feedback'
import {
  contact,
  conversation,
  conversationMessage,
  supportInbox,
  supportInboxMember,
} from '../../server/database/schema/support'
import { team } from '../../server/database/schema/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

async function activeTeam(request: Parameters<typeof signInAndGetSessionCookie>[0], sessionCookie: string) {
  const response = await request.get('/api/teams/active', { headers: withAuthHeaders(sessionCookie) })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { id: string; slug: string }
}

test('converts a support conversation and keeps ticket content private on the public board', async ({
  page,
  request,
}) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/support')
  const active = await activeTeam(request, sessionCookie)
  const [publicProject] = await db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(project)
    .where(and(eq(project.teamId, active.id), eq(project.isPublic, true)))
    .limit(1)
  const [teamRow] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, active.id)).limit(1)

  if (!publicProject || !teamRow) {
    test.skip()
    return
  }

  const suffix = randomUUID().slice(0, 8)
  const inboxId = randomUUID()
  const inboxMemberId = randomUUID()
  const contactId = randomUUID()
  const messageId = randomUUID()
  let conversationId: string | null = null
  let feedbackId: string | null = null

  try {
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId: active.id,
      name: `Feedback bridge ${suffix}`,
      slug: `feedback-bridge-${suffix}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const sessionResponse = await request.get('/api/auth/get-session', { headers })
    expect(sessionResponse.ok()).toBeTruthy()
    const sessionUserId = (await sessionResponse.json()).user?.id as string
    await db.insert(supportInboxMember).values({
      id: inboxMemberId,
      inboxId,
      userId: sessionUserId,
      role: 'agent',
      createdAt: new Date(),
    })
    await db.insert(contact).values({
      id: contactId,
      teamId: active.id,
      name: 'Private customer name',
      email: `feedback-bridge-${suffix}@example.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const conversationResponse = await request.post('/api/support/conversations', {
      headers,
      data: { inboxId, contactId, subject: 'Please add CSV exports', projectId: publicProject.id },
    })
    expect(conversationResponse.ok()).toBeTruthy()
    conversationId = (await conversationResponse.json()).data.conversation.id as string

    await db.insert(conversationMessage).values({
      id: messageId,
      conversationId,
      kind: 'incoming',
      body: 'Private ticket details that must not appear on the public board.',
      senderKind: 'contact',
      senderContactId: contactId,
      isPrivate: false,
      createdAt: new Date(),
    })

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.request.post('/api/teams/active', {
      headers: withOriginHeaders('/support'),
      data: { teamId: active.id },
    })
    await page.goto(`/support?inboxId=${inboxId}&conversationId=${conversationId}`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('support-thread-convert-feedback')).toBeVisible()
    await page.getByTestId('support-thread-convert-feedback').click()
    await expect(page.getByTestId('support-feedback-title')).toHaveValue('Please add CSV exports')
    await expect(page.getByTestId('support-feedback-body')).toHaveValue(
      'Private ticket details that must not appear on the public board.'
    )
    await expect(page.getByTestId('support-feedback-product')).toHaveValue(publicProject.id)

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/support/conversations/${conversationId}/feedback`)
    )
    await page.getByTestId('support-feedback-submit').click()
    expect((await createResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('support-thread-linked-feedback')).toBeVisible()

    const linkedResponse = await request.get(`/api/support/conversations/${conversationId}`, { headers })
    expect(linkedResponse.ok()).toBeTruthy()
    const linkedConversation = (await linkedResponse.json()).data.conversation
    feedbackId = linkedConversation.linkedFeedbackId as string
    expect(feedbackId).toBeTruthy()
    expect(linkedConversation.linkedFeedback).toMatchObject({
      id: feedbackId,
      status: 'open',
      voteCount: 0,
    })

    const messagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
    const messages = (await messagesResponse.json()).data.messages
    expect(messages.some((message: { body: string }) => message.body.includes('Linked conversation to feedback'))).toBe(
      true
    )

    const publicDetailResponse = await request.get(`/api/feedback/${feedbackId}`)
    expect(publicDetailResponse.ok()).toBeTruthy()
    const publicDetail = (await publicDetailResponse.json()).data
    expect(publicDetail.body).toBeNull()
    expect(publicDetail.author).toBeNull()
    expect(publicDetail.authorEmail).toBeNull()

    const publicBoardResponse = await request.get(`/api/public/t/${teamRow.slug}/${publicProject.slug}/feedback`)
    expect(publicBoardResponse.ok()).toBeTruthy()
    const boardItem = (await publicBoardResponse.json()).data.items.find(
      (item: { id: string }) => item.id === feedbackId
    )
    expect(boardItem).toMatchObject({ id: feedbackId, body: null, authorName: null })
  } finally {
    if (feedbackId) await db.delete(feedback).where(eq(feedback.id, feedbackId))
    if (conversationId) await db.delete(conversation).where(eq(conversation.id, conversationId))
    await db.delete(contact).where(eq(contact.id, contactId))
    await db.delete(supportInboxMember).where(eq(supportInboxMember.id, inboxMemberId))
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
  }
})
