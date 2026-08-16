import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import { contact, conversation, conversationMessage, supportInbox } from '../../server/database/schema/support'
import { resolveThread } from '../../server/utils/inbound-threading'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * The three resolution strategies need real rows and real joins, so they are
 * exercised here rather than against a fake transaction. Guarded like the other
 * integration suites: skips cleanly when no database is reachable.
 *
 * Calls go through `db.transaction` rather than passing `db`, so the suite
 * exercises the `tx` signature the endpoint will actually use.
 */
describe('resolveThread (real Postgres)', () => {
  const orgId = `org_thread_${randomUUID()}`
  const teamId = `team_thread_${randomUUID()}`
  const inboxId = `inbox_thread_${randomUUID()}`
  const contactId = `contact_thread_${randomUUID()}`
  const otherContactId = `contact_thread_other_${randomUUID()}`

  const inbox = { id: inboxId, teamId }
  const now = new Date()

  /**
   * `resolveThread` takes a `tx` because the endpoint resolves inside its own
   * insert transaction (the signature pinned in `parallel-agents.md`). Call it
   * the same way here rather than passing `db`, so the test exercises the real
   * contract.
   */
  function resolve(
    message: Parameters<typeof resolveThread>[2],
    forContactId: string,
    targetInbox: { id: string; teamId: string } = inbox
  ) {
    return db.transaction((tx: Tx) => resolveThread(tx, targetInbox, message, forContactId))
  }

  // Conversation the header strategies should find.
  const threadedConversationId = `conv_thread_${randomUUID()}`
  const storedMessageId = `stored-${randomUUID()}@acme.com`
  const threadRootId = `root-${randomUUID()}@acme.com`

  beforeAll(async () => {
    await db.insert(organization).values({
      id: orgId,
      name: 'Threading Integration Org',
      slug: `threading-org-${randomUUID()}`,
    })
    await db.insert(team).values({
      id: teamId,
      name: 'Threading Integration Team',
      slug: `threading-team-${randomUUID()}`,
      organizationId: orgId,
    })
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: 'Threading Inbox',
      slug: `threading-inbox-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(contact).values([
      {
        id: contactId,
        teamId,
        name: 'Jane',
        email: `jane-${randomUUID()}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherContactId,
        teamId,
        name: 'Bob',
        email: `bob-${randomUUID()}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await db.insert(conversation).values({
      id: threadedConversationId,
      inboxId,
      teamId,
      contactId,
      displayId: 9001,
      subject: 'Invoice question',
      status: 'open',
      channelThreadKey: threadRootId,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(conversationMessage).values({
      id: `msg_thread_${randomUUID()}`,
      conversationId: threadedConversationId,
      kind: 'outgoing',
      body: 'Our reply',
      senderKind: 'agent',
      channelMessageId: storedMessageId,
      createdAt: now,
    })
  })

  afterAll(async () => {
    // organization → team → inbox/contact/conversation → messages all cascade.
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  it('matches on In-Reply-To against a stored channelMessageId', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: storedMessageId, references: [], subject: 'Re: Invoice question' },
      contactId
    )

    expect(result).toEqual({ conversationId: threadedConversationId, matchedBy: 'message-id' })
  })

  it('matches on a References entry when In-Reply-To is absent', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [storedMessageId], subject: 'Anything' },
      contactId
    )

    expect(result.matchedBy).toBe('message-id')
    expect(result.conversationId).toBe(threadedConversationId)
  })

  it('matches a CC participant replying, who is a different contact', async () => {
    // Header matches are deliberately not contact-scoped: a CC'd participant is
    // a different contact on the same thread.
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: storedMessageId, references: [], subject: 'Re: Invoice question' },
      otherContactId
    )

    expect(result.conversationId).toBe(threadedConversationId)
  })

  it('falls back to the thread key when no stored message matches', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [threadRootId, 'unknown@x.com'], subject: 'Anything' },
      contactId
    )

    expect(result).toEqual({ conversationId: threadedConversationId, matchedBy: 'thread-key' })
  })

  it('matches on normalized subject for the same contact', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [], subject: 'Re: invoice   QUESTION' },
      contactId
    )

    expect(result).toEqual({ conversationId: threadedConversationId, matchedBy: 'subject' })
  })

  it('NEVER merges across contacts on the subject heuristic', async () => {
    // The important one. Two customers mailing "Invoice question" must not land
    // in one conversation, or each would see the other's correspondence.
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [], subject: 'Invoice question' },
      otherContactId
    )

    expect(result).toEqual({ conversationId: null, matchedBy: null })
  })

  it('does not match a different subject', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [], subject: 'Refund request' },
      contactId
    )

    expect(result.conversationId).toBeNull()
  })

  it('does not match a conversation in another inbox', async () => {
    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: storedMessageId, references: [], subject: 'Re: Invoice question' },
      contactId,
      { id: `inbox_other_${randomUUID()}`, teamId }
    )

    expect(result.conversationId).toBeNull()
  })

  it('does not match a resolved conversation on subject', async () => {
    await db.update(conversation).set({ status: 'resolved' }).where(eq(conversation.id, threadedConversationId))

    const result = await resolve(
      { messageId: 'new@x.com', inReplyTo: null, references: [], subject: 'Invoice question' },
      contactId
    )
    expect(result.conversationId).toBeNull()

    // A header match still reopens it - only the weak heuristic is restricted.
    const byHeader = await resolve(
      { messageId: 'new@x.com', inReplyTo: storedMessageId, references: [], subject: 'Re: Invoice question' },
      contactId
    )
    expect(byHeader.conversationId).toBe(threadedConversationId)

    await db.update(conversation).set({ status: 'open' }).where(eq(conversation.id, threadedConversationId))
  })

  it('returns no match for a message with no headers and no subject', async () => {
    const result = await resolve({ messageId: null, inReplyTo: null, references: [], subject: null }, contactId)

    expect(result).toEqual({ conversationId: null, matchedBy: null })
  })
})
