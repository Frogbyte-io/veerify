import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import { contact, conversation, supportInbox } from '../../server/database/schema/support'
import { account, session, teamMember, user, verification } from '../../server/database/schema/auth'
import { signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders } from './helpers/auth'

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
    const headers = withAuthHeaders(sessionCookie, '/support')
    const teamId = await activeTeamId(request, sessionCookie)

    const suffix = randomUUID().slice(0, 8)
    const adminCredentials = { email: `support-flow-admin-${suffix}@example.com`, password: TEST_PASSWORD }
    let adminUserId: string | undefined
    let teamMemberId: string | undefined
    const createdInboxIds: string[] = []
    const createdContactIds: string[] = []
    const createdConversationIds: string[] = []

    try {
      // The creator is added as a supportInboxMember with role 'admin', which
      // is what grants access below — the seed user's teamMember role is only
      // 'member', so inbox access cannot be coming from the team-admin bypass.
      const deniedResponse = await request.post('/api/support/inboxes', {
        headers,
        data: { teamId, name: `Denied E2E Inbox ${suffix}`, slug: `denied-e2e-inbox-${suffix}` },
      })
      expect(deniedResponse.status()).toBe(403)
      expect(await deniedResponse.text()).toContain('FORBIDDEN')

      const signupResponse = await request.post('/api/auth/sign-up/email', {
        headers: withOriginHeaders('/signup'),
        data: { name: 'Support flow setup admin', ...adminCredentials },
      })
      expect(signupResponse.ok()).toBeTruthy()
      adminUserId = ((await signupResponse.json()).user?.id || '') as string
      expect(adminUserId).toBeTruthy()
      teamMemberId = randomUUID()
      await db
        .insert(teamMember)
        .values({ id: teamMemberId, teamId, userId: adminUserId, role: 'admin', createdAt: new Date() })

      const adminCookie = await signInAndGetSessionCookie(request, adminCredentials)
      const adminHeaders = withAuthHeaders(adminCookie, '/support')
      const inboxResponse = await request.post('/api/support/inboxes', {
        headers: adminHeaders,
        data: { teamId, name: `E2E Inbox ${suffix}`, slug: `e2e-inbox-${suffix}` },
      })
      if (!inboxResponse.ok())
        throw new Error(`Inbox setup failed: ${inboxResponse.status()} ${await inboxResponse.text()}`)
      const inboxId = (await inboxResponse.json()).data.inbox.id as string
      createdInboxIds.push(inboxId)

      const agentSessionResponse = await request.get('/api/auth/session', { headers })
      expect(agentSessionResponse.ok()).toBeTruthy()
      const agentSession = (await agentSessionResponse.json()).data.user as { id: string; name: string }
      const agentUserId = agentSession.id
      const addAgentResponse = await request.post(`/api/support/inboxes/${inboxId}/members`, {
        headers: adminHeaders,
        data: { userId: agentUserId, role: 'agent' },
      })
      if (!addAgentResponse.ok()) {
        throw new Error(`Agent membership setup failed: ${addAgentResponse.status()} ${await addAgentResponse.text()}`)
      }

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
        headers: adminHeaders,
        data: { emailAddress: `e2e-sender-${suffix}@example.com`, fromName: 'E2E Support' },
      })
      expect(identityResponse.ok()).toBeTruthy()

      // 2. An internal note on an unassigned conversation stays unassigned.
      // `isPrivate` is derived server-side from `kind`, so this also asserts
      // the note cannot accidentally become customer-visible.
      const noteResponse = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'note', body: 'Third report of this today — possible regression.' },
      })
      expect(noteResponse.ok()).toBeTruthy()
      const note = (await noteResponse.json()).data.message
      expect(note.kind).toBe('note')
      expect(note.isPrivate).toBe(true)

      const afterNoteResponse = await request.get(`/api/support/conversations/${conversationId}`, { headers })
      expect(afterNoteResponse.ok()).toBeTruthy()
      expect((await afterNoteResponse.json()).data.conversation.assigneeUserId).toBeNull()

      // 3. The first customer-visible reply atomically claims the ticket.
      const replyResponse = await request.post(`/api/support/conversations/${conversationId}/messages`, {
        headers,
        data: { kind: 'outgoing', body: 'Have you tried resetting your password?' },
      })
      expect(replyResponse.ok()).toBeTruthy()
      const reply = (await replyResponse.json()).data.message
      expect(reply.kind).toBe('outgoing')
      expect(reply.isPrivate).toBe(false)

      const afterReplyResponse = await request.get(`/api/support/conversations/${conversationId}`, { headers })
      expect(afterReplyResponse.ok()).toBeTruthy()
      expect((await afterReplyResponse.json()).data.conversation.assigneeUserId).toBe(agentUserId)

      // 4. Handoff, release, and reclaim all use the same assignment API.
      if (!adminUserId) throw new Error('Support flow admin fixture disappeared')
      const handoffResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { assigneeUserId: adminUserId },
      })
      expect(handoffResponse.ok()).toBeTruthy()
      expect((await handoffResponse.json()).data.conversation.assigneeUserId).toBe(adminUserId)

      const unassignResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { assigneeUserId: null },
      })
      expect(unassignResponse.ok()).toBeTruthy()
      expect((await unassignResponse.json()).data.conversation.assigneeUserId).toBeNull()

      const reclaimResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { assigneeUserId: agentUserId },
      })
      expect(reclaimResponse.ok()).toBeTruthy()
      expect((await reclaimResponse.json()).data.conversation.assigneeUserId).toBe(agentUserId)

      // 5. Change status.
      const patchResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { status: 'resolved' },
      })
      expect(patchResponse.ok()).toBeTruthy()
      const patched = await patchResponse.json()
      expect(patched.data.changed).toBe(true)
      expect(patched.data.conversation.status).toBe('resolved')
      expect(patched.data.conversation.resolvedAt).not.toBeNull()

      // 6. Every ownership and status change renders once in the thread as an activity
      // message, from the same ordered query as the replies.
      const messagesResponse = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      expect(messagesResponse.ok()).toBeTruthy()
      const messages = (await messagesResponse.json()).data.messages as Array<Record<string, unknown>>

      expect(messages).toHaveLength(7)
      expect(messages.map((m) => m.kind)).toEqual([
        'note',
        'outgoing',
        'activity',
        'activity',
        'activity',
        'activity',
        'activity',
      ])

      const claimActivity = messages[2]
      expect(claimActivity.body).toBe(`Assigned to ${agentSession.name}.`)
      expect(claimActivity.senderKind).toBe('system')

      expect(messages[3].body).toBe('Assigned to Support flow setup admin.')
      expect(messages[4].body).toBe('Unassigned.')
      expect(messages[5].body).toBe(`Assigned to ${agentSession.name}.`)

      const activity = messages[6]
      expect(activity.body).toBe('Status changed from open to resolved.')
      expect(activity.senderKind).toBe('system')

      // 7. Reopening preserves the owner and records only the status change.
      const reopenResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { status: 'open' },
      })
      expect(reopenResponse.ok()).toBeTruthy()
      const reopened = (await reopenResponse.json()).data.conversation
      expect(reopened.status).toBe('open')
      expect(reopened.resolvedAt).toBeNull()
      expect(reopened.assigneeUserId).toBe(agentUserId)

      // 8. Re-sending the same status is not a change, so it must not append a
      // second activity message saying nothing happened.
      const noopResponse = await request.patch(`/api/support/conversations/${conversationId}`, {
        headers,
        data: { status: 'open' },
      })
      expect(noopResponse.ok()).toBeTruthy()
      expect((await noopResponse.json()).data.changed).toBe(false)

      const afterNoop = await request.get(`/api/support/conversations/${conversationId}/messages`, { headers })
      const afterNoopMessages = (await afterNoop.json()).data.messages as Array<Record<string, unknown>>
      expect(afterNoopMessages).toHaveLength(8)
      expect(afterNoopMessages[7].body).toBe('Status changed from resolved to open.')
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
      if (teamMemberId) await db.delete(teamMember).where(eq(teamMember.id, teamMemberId))
      if (adminUserId) {
        await db.delete(verification).where(eq(verification.identifier, adminCredentials.email))
        await db.delete(session).where(eq(session.userId, adminUserId))
        await db.delete(account).where(eq(account.userId, adminUserId))
        await db.delete(user).where(eq(user.id, adminUserId))
      }
    }
  })
})
