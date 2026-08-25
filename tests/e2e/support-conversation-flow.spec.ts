import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportInbox } from '../../server/database/schema/support'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function activeTeamId(request: Parameters<typeof signInAndGetSessionCookie>[0], sessionCookie: string) {
  const response = await request.get('/api/teams/active', { headers: withAuthHeaders(sessionCookie) })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data.id as string
}

/**
 * Stage 02's end-to-end agent flow: create a conversation, reply, add an
 * internal note, change status, and confirm the status change rendered itself
 * into the thread as an `activity` message.
 *
 * Deliberately API-level. The realtime half of acceptance criterion 1 ("two
 * agents in two browsers on two app instances, one replies and the other sees
 * it without a refresh") is **not** covered here — it needs two app instances
 * and a shared broker, which this suite has no way to stand up. Tracked as
 * still-open in TODO.md rather than pretended to be covered.
 */
test.describe.serial('support conversation flow', () => {
  test('create, reply, note, status change, and activity message', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const headers = withAuthHeaders(sessionCookie)
    const teamId = await activeTeamId(request, sessionCookie)

    const suffix = randomUUID().slice(0, 8)
    const createdInboxIds: string[] = []
    const createdContactIds: string[] = []
    const createdConversationIds: string[] = []

    try {
      // The creator is added as a supportInboxMember with role 'admin', which
      // is what grants access below — the seed user's teamMember role is only
      // 'member', so inbox access cannot be coming from the team-admin bypass.
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers,
        data: { teamId, name: `E2E Inbox ${suffix}`, slug: `e2e-inbox-${suffix}` },
      })
      expect(inboxResponse.ok()).toBeTruthy()
      const inboxId = (await inboxResponse.json()).data.inbox.id as string
      createdInboxIds.push(inboxId)

      const visibleInboxesResponse = await request.get('/api/support/inboxes', {
        headers,
        params: { teamId },
      })
      expect(visibleInboxesResponse.ok()).toBeTruthy()
      const visibleInbox = (await visibleInboxesResponse.json()).data.inboxes.find(
        (inbox: { id: string }) => inbox.id === inboxId
      )
      expect(visibleInbox?.capabilities?.canWorkConversations).toBe(true)

      const contactResponse = await request.post('/api/support/contacts', {
        headers,
        data: { teamId, name: 'E2E Customer', email: `e2e-conv-${suffix}@example.com` },
      })
      expect(contactResponse.ok()).toBeTruthy()
      const contactId = (await contactResponse.json()).data.contact.id as string
      createdContactIds.push(contactId)

      // 1. Create the conversation.
      const createResponse = await request.post('/api/support/conversations', {
        headers,
        data: { inboxId, contactId, subject: 'Cannot sign in' },
      })
      expect(createResponse.ok()).toBeTruthy()
      const created = (await createResponse.json()).data.conversation
      const conversationId = created.id as string
      createdConversationIds.push(conversationId)

      expect(created.status).toBe('open')
      // Allocated from supportCounter, so it must be a real ticket number.
      expect(typeof created.displayId).toBe('number')
      expect(created.displayId).toBeGreaterThan(0)

      // Outgoing replies require an explicit From identity. Configure the
      // inbox through the same operator-facing API used by Stage 04 before
      // exercising the Stage 02 reply flow.
      const identityResponse = await request.put(`/api/support/inboxes/${inboxId}`, {
        headers,
        data: { emailAddress: `e2e-sender-${suffix}@example.com`, fromName: 'E2E Support' },
      })
      expect(identityResponse.ok()).toBeTruthy()

      // 2. Reply — customer-visible.
      const replyResponse = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'Have you tried resetting your password?' },
      })
      expect(replyResponse.ok()).toBeTruthy()
      const reply = (await replyResponse.json()).data.message
      expect(reply.kind).toBe('outgoing')
      expect(reply.isPrivate).toBe(false)

      // 3. Internal note — must never be customer-visible. `isPrivate` is
      // derived server-side from `kind`, so this asserts the server's guard,
      // not just what the client asked for.
      const noteResponse = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'note', body: 'Third report of this today — possible regression.' },
      })
      expect(noteResponse.ok()).toBeTruthy()
      const note = (await noteResponse.json()).data.message
      expect(note.kind).toBe('note')
      expect(note.isPrivate).toBe(true)

      // 4. Change status.
      const patchResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { status: 'resolved' },
      })
      expect(patchResponse.ok()).toBeTruthy()
      const patched = await patchResponse.json()
      expect(patched.data.changed).toBe(true)
      expect(patched.data.conversation.status).toBe('resolved')
      expect(patched.data.conversation.resolvedAt).not.toBeNull()

      // 5. The status change must render inline in the thread as an activity
      // message, from the same ordered query as the replies.
      const messagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      expect(messagesResponse.ok()).toBeTruthy()
      const messages = (await messagesResponse.json()).data.messages as Array<Record<string, unknown>>

      expect(messages).toHaveLength(3)
      expect(messages.map((m) => m.kind)).toEqual(['outgoing', 'note', 'activity'])

      const activity = messages[2]
      expect(activity.body).toBe('Status changed from open to resolved.')
      expect(activity.senderKind).toBe('system')

      // 6. Re-sending the same status is not a change, so it must not append a
      // second activity message saying nothing happened.
      const noopResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { status: 'resolved' },
      })
      expect(noopResponse.ok()).toBeTruthy()
      expect((await noopResponse.json()).data.changed).toBe(false)

      const afterNoop = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      expect(((await afterNoop.json()).data.messages as unknown[]).length).toBe(3)
    } finally {
      // Conversations first: supportInbox is referenced with onDelete restrict.
      if (createdConversationIds.length > 0) {
        await db.delete(conversation).where(inArray(conversation.id, createdConversationIds))
      }
      if (createdContactIds.length > 0) {
        await db.delete(contact).where(inArray(contact.id, createdContactIds))
      }
      for (const inboxId of createdInboxIds) {
        await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
      }
    }
  })
})
