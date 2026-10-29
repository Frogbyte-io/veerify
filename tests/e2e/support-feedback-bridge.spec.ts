import { enableProjectSupport } from './helpers/support-project'
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from './helpers/db'
import { loginViaProgrammaticPage, signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'
import { feedback, product, project } from '../../server/database/schema/feedback'
import { organization } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationMessage,
  supportInbox,
  supportInboxMember,
} from '../../server/database/schema/support'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

async function activeProject(request: Parameters<typeof signInAndGetSessionCookie>[0], sessionCookie: string) {
  const response = await request.get('/api/projects/active', { headers: withAuthHeaders(sessionCookie) })
  expect(response.ok()).toBeTruthy()
  const active = (await response.json()).data.project as { id: string; slug: string }
  await enableProjectSupport(active.id)
  return active
}

test('converts a support conversation and keeps ticket content private on the public board', async ({
  page,
  request,
}) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const headers = withAuthHeaders(sessionCookie, '/inbox')
  const active = await activeProject(request, sessionCookie)
  const [publicProject] = await db
    .select({ id: project.id, slug: project.slug, name: project.name, organizationId: project.organizationId })
    .from(project)
    .where(and(eq(project.id, active.id), eq(project.isPublic, true)))
    .limit(1)
  const [publicProduct] = publicProject
    ? await db
        .select({ id: product.id, slug: product.slug })
        .from(product)
        .where(and(eq(product.projectId, publicProject.id), eq(product.isPublic, true)))
        .limit(1)
    : []
  const [orgRow] = publicProject
    ? await db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, publicProject.organizationId))
        .limit(1)
    : []
  const projectRow = orgRow

  if (!publicProject || !publicProduct || !projectRow) {
    test.skip()
    return
  }

  const suffix = randomUUID().slice(0, 8)
  const inboxId = randomUUID()
  const inboxMemberId = randomUUID()
  const secondProductId = randomUUID()
  const secondProductSlug = `bridge-beta-${suffix}`
  const contactId = randomUUID()
  const messageId = randomUUID()
  let conversationId: string | null = null
  let feedbackId: string | null = null
  let roadmapSwitchedOn = false

  try {
    // With a single product the dialog hides the product layer, so give the project a second public
    // product: the picker appears, defaults to the first product, and lets the agent route elsewhere.
    await db.insert(product).values({
      id: secondProductId,
      projectId: active.id,
      name: `Bridge Beta ${suffix}`,
      slug: secondProductSlug,
      isPublic: true,
      sortOrder: 999,
    })
    await db.insert(supportInbox).values({
      id: inboxId,
      projectId: active.id,
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
      projectId: active.id,
      name: 'Private customer name',
      email: `feedback-bridge-${suffix}@example.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const conversationResponse = await request.post('/api/support/conversations', {
      headers,
      data: { inboxId, contactId, subject: 'Please add CSV exports' },
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
    await page.request.post('/api/projects/active', {
      headers: withOriginHeaders('/inbox'),
      data: { projectId: active.id },
    })
    await page.goto(`/inbox?inboxId=${inboxId}&conversationId=${conversationId}`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('support-thread-convert-feedback')).toBeVisible()
    await page.getByTestId('support-thread-convert-feedback').click()
    await expect(page.getByTestId('support-feedback-title')).toHaveValue('Please add CSV exports')
    await expect(page.getByTestId('support-feedback-body')).toHaveValue(
      'Private ticket details that must not appear on the public board.'
    )
    await expect(page.getByTestId('support-feedback-product')).toHaveValue(publicProduct.id)
    await page.getByTestId('support-feedback-product').selectOption(secondProductId)

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
    const [created] = await db
      .select({ productId: feedback.productId })
      .from(feedback)
      .where(eq(feedback.id, feedbackId))
    expect(created?.productId).toBe(secondProductId)
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

    const publicHeaders = { cookie: '' }
    const publicDetailResponse = await request.get(`/api/feedback/${feedbackId}`, { headers: publicHeaders })
    expect(publicDetailResponse.ok()).toBeTruthy()
    const publicDetail = (await publicDetailResponse.json()).data
    expect(publicDetail.title).toBe('Support request')
    expect(publicDetail.title).not.toContain('Please add CSV exports')
    expect(publicDetail.body).toBeNull()
    expect(publicDetail.author).toBeNull()
    expect(publicDetail.authorEmail).toBeNull()

    const publicBoardResponse = await request.get(
      `/api/public/o/${projectRow.slug}/${publicProject.slug}/products/${secondProductSlug}/feedback`,
      {
        headers: publicHeaders,
      }
    )
    expect(publicBoardResponse.ok()).toBeTruthy()
    const boardItem = (await publicBoardResponse.json()).data.items.find(
      (item: { id: string }) => item.id === feedbackId
    )
    expect(boardItem).toMatchObject({ id: feedbackId, title: 'Support request', body: null, authorName: null })

    // The public roadmap 404s unless the Roadmap tool is switched on for the project.
    await db
      .update(project)
      .set({ settings: sql`coalesce(${project.settings}, '{}'::jsonb) || '{"roadmapEnabled": true}'::jsonb` })
      .where(eq(project.id, active.id))
    roadmapSwitchedOn = true
    const roadmapResponse = await request.get(`/api/public/o/${projectRow.slug}/${publicProject.slug}/roadmap`, {
      headers: publicHeaders,
    })
    expect(roadmapResponse.ok()).toBeTruthy()
    const roadmapColumns = (await roadmapResponse.json()).data.columns
    const roadmapItem = roadmapColumns
      .flatMap((column: { items: Array<{ id: string }> }) => column.items)
      .find((item: { id: string }) => item.id === feedbackId)
    expect(roadmapItem).toMatchObject({ id: feedbackId, title: 'Support request', body: null, authorName: null })
  } finally {
    if (roadmapSwitchedOn) {
      await db
        .update(project)
        .set({ settings: sql`${project.settings} - 'roadmapEnabled'` })
        .where(eq(project.id, active.id))
    }
    if (feedbackId) await db.delete(feedback).where(eq(feedback.id, feedbackId))
    if (conversationId) await db.delete(conversation).where(eq(conversation.id, conversationId))
    await db.delete(contact).where(eq(contact.id, contactId))
    await db.delete(supportInboxMember).where(eq(supportInboxMember.id, inboxMemberId))
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
    await db.delete(product).where(eq(product.id, secondProductId))
  }
})
