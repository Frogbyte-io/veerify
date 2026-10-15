import { createHmac, randomUUID } from 'node:crypto'
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * One email, several Veerify inboxes, through the real inbound route and a
 * real database.
 *
 * Mailgun and Frogmail post one signed callback per envelope recipient, all
 * with the same Message-Id. Each inbox must get its own ticket, a retried
 * callback must still be suppressed, and two aliases of one inbox must file
 * the email once even when their callbacks race.
 *
 * Only the edges that need infrastructure this suite does not have are
 * mocked: h3's request accessors, object storage, rate limiting, realtime
 * publishing and automation triggers. Signature verification, parsing,
 * routing, the event claim, threading and every insert are real.
 */

interface FakeEvent {
  headers: Record<string, string>
  rawBody: Buffer
  _requestBody?: Buffer
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getHeaders: (event: FakeEvent) => event.headers,
  getRouterParam: () => 'mailgun',
  readRawBody: async (event: FakeEvent) => event.rawBody,
  readMultipartFormData: async () => undefined,
  setResponseStatus: () => undefined,
}))
vi.mock('~/server/utils/storage', () => ({
  getStorageProvider: () => ({ putObject: async () => undefined, deleteObject: async () => undefined }),
}))
vi.mock('~/server/utils/rate-limit', () => ({ checkRateLimit: async () => true }))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: async () => undefined }))
vi.mock('~/server/utils/automation-engine', () => ({ triggerAutomationEvent: async () => undefined }))

const SIGNING_KEY = 'integration-signing-key'
vi.stubEnv('SUPPORT_MAILGUN_SIGNING_KEY', SIGNING_KEY)

const { db } = await import('../../server/database/drizzle')
const { organization, team } = await import('../../server/database/schema/auth')
const { teamModuleSettings } = await import('../../server/database/schema/teams')
const { conversation, conversationMessage, supportEmailEvent, supportInbox, supportInboxAddress } =
  await import('../../server/database/schema/support')
const handler = (await import('../../server/api/support/inbound/[provider].post')).default as unknown as (
  event: FakeEvent
) => Promise<{ data: { accepted: boolean; reason?: string; conversationId?: string } }>

describe('inbound deduplication per inbox (real Postgres)', () => {
  const runId = randomUUID().slice(0, 8)
  const orgId = `org_dedupe_${runId}`
  const teamA = `team_dedupe_a_${runId}`
  const teamB = `team_dedupe_b_${runId}`
  const inboxA = `inbox_dedupe_a_${runId}`
  const inboxB = `inbox_dedupe_b_${runId}`
  const addressA = `support-${runId}@a.example.test`
  const aliasA = `help-${runId}@a.example.test`
  const addressB = `support-${runId}@b.example.test`
  // More aliases of inbox A, so the race below has real contention.
  const raceAliasesA = Array.from({ length: 6 }, (_, index) => `alias${index}-${runId}@a.example.test`)
  const now = new Date()

  function callback(
    recipient: string,
    messageId: string,
    to = `${addressA}, ${addressB}`,
    threading: { inReplyTo?: string; references?: string[] } = {}
  ): FakeEvent {
    const timestamp = String(Math.floor(Date.now() / 1000))
    // A fresh token per callback, as providers sign every attempt afresh.
    const token = randomUUID().replace(/-/g, '')
    const signature = createHmac('sha256', SIGNING_KEY)
      .update(timestamp + token)
      .digest('hex')
    const payload = {
      timestamp,
      token,
      signature,
      'Message-Id': `<${messageId}>`,
      from: `Customer <customer-${runId}@example.test>`,
      recipient,
      To: to,
      subject: `Help needed ${messageId}`,
      'body-plain': 'Hello, I need help.',
      'message-headers': JSON.stringify([
        ['Message-Id', `<${messageId}>`],
        ['Date', now.toUTCString()],
        ...(threading.inReplyTo ? [['In-Reply-To', `<${threading.inReplyTo}>`]] : []),
        ...(threading.references ? [['References', threading.references.map((id) => `<${id}>`).join(' ')]] : []),
      ]),
    }
    return { headers: { 'content-type': 'application/json' }, rawBody: Buffer.from(JSON.stringify(payload)) }
  }

  async function filedCopies(messageId: string) {
    return db
      .select({ inboxId: conversation.inboxId, conversationId: conversation.id })
      .from(conversationMessage)
      .innerJoin(conversation, eq(conversationMessage.conversationId, conversation.id))
      .where(and(eq(conversationMessage.channelMessageId, messageId), eq(conversationMessage.kind, 'incoming')))
  }

  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'Dedupe Org', slug: `dedupe-org-${runId}` })
    await db.insert(team).values([
      { id: teamA, name: 'Team A', slug: `dedupe-team-a-${runId}`, organizationId: orgId },
      { id: teamB, name: 'Team B', slug: `dedupe-team-b-${runId}`, organizationId: orgId },
    ])
    await db.insert(teamModuleSettings).values([
      { teamId: teamA, supportEnabled: true },
      { teamId: teamB, supportEnabled: true },
    ])
    await db.insert(supportInbox).values([
      { id: inboxA, teamId: teamA, name: 'A', slug: `dedupe-a-${runId}`, createdAt: now, updatedAt: now },
      { id: inboxB, teamId: teamB, name: 'B', slug: `dedupe-b-${runId}`, createdAt: now, updatedAt: now },
    ])
    await db
      .insert(supportInboxAddress)
      .values([
        { id: `addr_a_${runId}`, inboxId: inboxA, address: addressA, isPrimary: true },
        { id: `addr_a_alias_${runId}`, inboxId: inboxA, address: aliasA },
        { id: `addr_b_${runId}`, inboxId: inboxB, address: addressB, isPrimary: true },
        ...raceAliasesA.map((address, index) => ({ id: `addr_a_race_${index}_${runId}`, inboxId: inboxA, address })),
      ])
  })

  afterAll(async () => {
    // organization -> teams -> inboxes -> conversations/messages/events all cascade.
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(supportEmailEvent).where(like(supportEmailEvent.providerEventId, `%${runId}%`))
  })

  it('gives each of two inboxes its own ticket for one email', async () => {
    const messageId = `two-inboxes-${runId}@example.test`

    const first = await handler(callback(addressA, messageId))
    const second = await handler(callback(addressB, messageId))

    expect(first.data).toMatchObject({ accepted: true, created: true })
    expect(second.data).toMatchObject({ accepted: true, created: true })
    const copies = await filedCopies(messageId)
    expect(copies.map((copy) => copy.inboxId).sort()).toEqual([inboxA, inboxB].sort())
    expect(new Set(copies.map((copy) => copy.conversationId)).size).toBe(2)
  })

  it('still drops a retry of the same recipient callback', async () => {
    const messageId = `retry-${runId}@example.test`

    await handler(callback(addressA, messageId))
    const retry = await handler(callback(addressA, messageId))

    expect(retry.data).toMatchObject({ accepted: true, reason: 'duplicate-delivery' })
    expect(await filedCopies(messageId)).toHaveLength(1)
  })

  it('files an email sent to two aliases of one inbox once', async () => {
    const messageId = `aliases-${runId}@example.test`

    await handler(callback(addressA, messageId, `${addressA}, ${aliasA}`))
    const alias = await handler(callback(aliasA, messageId, `${addressA}, ${aliasA}`))

    expect(alias.data).toMatchObject({ accepted: true, reason: 'duplicate-in-inbox' })
    const copies = await filedCopies(messageId)
    expect(copies).toHaveLength(1)
    expect(copies[0].inboxId).toBe(inboxA)
  })

  it.each([1, 2, 3])('files one copy per inbox when callbacks for every recipient race (round %i)', async (round) => {
    const messageId = `race-${round}-${runId}@example.test`
    const recipientsA = [addressA, aliasA, ...raceAliasesA]
    const to = [...recipientsA, addressB].join(', ')

    const results = await Promise.all([
      ...recipientsA.map((recipient) => handler(callback(recipient, messageId, to))),
      handler(callback(addressB, messageId, to)),
      // A provider retry of one of them, in flight at the same time.
      handler(callback(addressB, messageId, to)),
    ])

    expect(results.every((result) => result.data.accepted)).toBe(true)
    const copies = await filedCopies(messageId)
    expect(copies.map((copy) => copy.inboxId).sort()).toEqual([inboxA, inboxB].sort())

    const events = await db
      .select({ providerEventId: supportEmailEvent.providerEventId })
      .from(supportEmailEvent)
      .where(inArray(supportEmailEvent.inboxId, [inboxA, inboxB]))
    const raceEvents = events.filter((event) => event.providerEventId.startsWith(`${messageId} `))
    // One event per envelope recipient; the concurrent retry shares B's.
    expect(raceEvents).toHaveLength(recipientsA.length + 1)
  })

  it('threads a reply to an SES-rewritten Message-ID onto the ticket through References', async () => {
    // Frogmail's ses-reply shape: the client quotes only the SES id, and
    // Frogmail appends the Message-ID Veerify sent to References.
    const firstId = `ses-thread-${runId}@example.test`
    const opened = await handler(callback(addressA, firstId))
    const conversationId = opened.data.conversationId as string
    const ownReplyId = `agent-reply-${runId}@a.example.test`
    await db.insert(conversationMessage).values({
      id: `msg_agent_${runId}`,
      conversationId,
      kind: 'outgoing',
      body: 'We fixed it.',
      senderKind: 'agent',
      channelMessageId: ownReplyId,
      createdAt: new Date(),
    })
    const sesId = `0100019b-${runId}@email.amazonses.com`

    const reply = await handler(
      callback(addressA, `customer-reply-${runId}@example.test`, addressA, {
        inReplyTo: sesId,
        references: [sesId, ownReplyId],
      })
    )

    expect(reply.data).toMatchObject({ accepted: true, created: false, conversationId })
  })
})
