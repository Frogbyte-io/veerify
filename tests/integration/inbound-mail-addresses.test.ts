import { createHmac, randomUUID } from 'node:crypto'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Project email addresses through the real inbound route and a real database
 * (design docs/plans/2026-10-28-email-addresses/design.md):
 *
 * - catch-all delivery (`*@domain`), and exact addresses winning over it;
 * - the matched address and its behaviour recorded on a new conversation, and
 *   a `mail` address getting no auto-reply or SLA;
 * - the provider's spam verdict filing into Spam, quietly;
 * - replies to conversations in Trash (restored) and Spam (stay there).
 *
 * As in inbound-route-dedupe.test.ts, only infrastructure edges are mocked:
 * h3's request accessors, storage, rate limiting, realtime, the outbound
 * worker and the automation trigger (spied, to see which messages fire it).
 */

interface FakeEvent {
  headers: Record<string, string>
  rawBody: Buffer
  _requestBody?: Buffer
}

const automation = vi.hoisted(() => ({ triggerAutomationEvent: vi.fn(async () => undefined) }))

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
vi.mock('~/server/services/rate-limit', () => ({ getRateLimitStore: () => ({ consume: async () => true }) }))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: async () => undefined }))
vi.mock('~/server/utils/automation-engine', () => automation)
// Sender authorization has its own suites; here the inbox may always send its auto-reply.
vi.mock('~/server/utils/sender-enforcement', () => ({ isSenderAllowedOrRecordBlock: async () => true }))
vi.mock('~/server/utils/outbound-delivery', () => ({
  enqueueOutboundDelivery: async () => undefined,
  runOutboundDeliveryWorker: async () => undefined,
}))

const SIGNING_KEY = 'integration-signing-key-mail'
vi.stubEnv('SUPPORT_MAILGUN_SIGNING_KEY', SIGNING_KEY)

const { db } = await import('../../server/database/drizzle')
const { organization } = await import('../../server/database/schema/auth')
const { project } = await import('../../server/database/schema/feedback')
const {
  conversation,
  conversationMessage,
  projectMailAddress,
  projectMailDomain,
  slaPolicy,
  slaTarget,
  supportEmailEvent,
  supportInbox,
} = await import('../../server/database/schema/support')
const handler = (await import('../../server/api/support/inbound/[provider].post')).default as unknown as (
  event: FakeEvent
) => Promise<{ data: { accepted: boolean; reason?: string; conversationId?: string; created?: boolean } }>

const runId = randomUUID().slice(0, 8)
const orgId = `org_mailaddr_${runId}`
const projectId = `project_mailaddr_${runId}`
const inboxId = `inbox_mailaddr_${runId}`
const domainId = `domain_mailaddr_${runId}`
const domain = `newsite-${runId}.example.test`
const exactId = `addr_exact_${runId}`
const catchAllId = `addr_catchall_${runId}`
const exactAddress = `hello@${domain}`
const now = new Date()

interface MailOptions {
  recipient: string
  messageId?: string
  inReplyTo?: string
  fields?: Record<string, string>
}

function callback(options: MailOptions): { event: FakeEvent; messageId: string } {
  const messageId = options.messageId ?? `${randomUUID()}@sender.example.test`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const token = randomUUID().replace(/-/g, '')
  const signature = createHmac('sha256', SIGNING_KEY)
    .update(timestamp + token)
    .digest('hex')
  const payload = {
    timestamp,
    token,
    signature,
    'Message-Id': `<${messageId}>`,
    from: `Customer <customer-${runId}@sender.example.test>`,
    recipient: options.recipient,
    To: options.recipient,
    subject: `Question ${messageId}`,
    'body-plain': 'Hello there.',
    'message-headers': JSON.stringify([
      ['Message-Id', `<${messageId}>`],
      ['Date', new Date().toUTCString()],
      ...(options.inReplyTo ? [['In-Reply-To', `<${options.inReplyTo}>`]] : []),
    ]),
    ...options.fields,
  }
  return {
    messageId,
    event: { headers: { 'content-type': 'application/json' }, rawBody: Buffer.from(JSON.stringify(payload)) },
  }
}

async function deliver(options: MailOptions) {
  const { event, messageId } = callback(options)
  const response = await handler(event)
  return { response, messageId }
}

async function conversationRow(id: string | undefined) {
  const [row] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, id as string))
  return row
}

async function messagesOf(conversationId: string) {
  return db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, conversationId))
}

const autoReplies = async (conversationId: string) =>
  (await messagesOf(conversationId)).filter((message) => message.kind === 'outgoing')

beforeAll(async () => {
  await db.insert(organization).values({ id: orgId, name: 'Mail Org', slug: `mail-org-${runId}` })
  await db.insert(project).values({
    id: projectId,
    name: 'Mail project',
    slug: `mail-project-${runId}`,
    organizationId: orgId,
    settings: { supportEnabled: true },
  })
  await db.insert(supportInbox).values({
    id: inboxId,
    projectId,
    name: 'Inbox',
    slug: `inbox-${runId}`,
    emailAddress: exactAddress,
    autoReplyEnabled: true,
    autoReplyTemplate: 'Thanks, we got your message.',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(projectMailDomain).values({
    id: domainId,
    projectId,
    domain,
    registrableDomain: domain,
    status: 'verified',
    provider: 'mailgun',
    ownershipToken: 'tok',
  })
  await db.insert(projectMailAddress).values([
    { id: exactId, inboxId, projectId, address: exactAddress, domainId, behaviour: 'helpdesk', isPrimary: true },
    { id: catchAllId, inboxId, projectId, address: `*@${domain}`, domainId, behaviour: 'mail' },
  ])
  // A default SLA policy, so helpdesk conversations get a first-response deadline.
  await db.insert(slaPolicy).values({
    id: `sla_${runId}`,
    projectId,
    name: 'Default',
    conditions: {},
    escalation: {},
    isDefault: true,
  })
  await db.insert(slaTarget).values({
    id: `sla_target_${runId}`,
    slaPolicyId: `sla_${runId}`,
    metric: 'first_response',
    priority: null,
    targetMinutes: 60,
  })
})

beforeEach(() => {
  automation.triggerAutomationEvent.mockClear()
})

afterAll(async () => {
  // organization -> project -> inbox, domain, addresses, conversations all cascade.
  await db.delete(organization).where(eq(organization.id, orgId))
  await db.delete(supportEmailEvent).where(like(supportEmailEvent.providerEventId, `%${runId}%`))
})

describe('inbound mail on project addresses (real Postgres)', () => {
  it('records the exact address and its helpdesk behaviour; auto-reply, SLA and automation apply', async () => {
    const { response } = await deliver({ recipient: exactAddress })

    expect(response.data).toMatchObject({ accepted: true, created: true })
    const row = await conversationRow(response.data.conversationId)
    expect(row).toMatchObject({ mailAddressId: exactId, behaviour: 'helpdesk', spamAt: null, deletedAt: null })
    expect(row.firstResponseDueAt).not.toBeNull()
    expect(await autoReplies(row.id)).toHaveLength(1)
    expect(automation.triggerAutomationEvent).toHaveBeenCalledWith({
      conversationId: row.id,
      trigger: 'conversation_created',
    })
  })

  it('delivers mail for an unlisted address to the catch-all, as a mail conversation without auto-reply or SLA', async () => {
    const { response } = await deliver({ recipient: `Someone.Else@${domain.toUpperCase()}` })

    expect(response.data).toMatchObject({ accepted: true, created: true })
    const row = await conversationRow(response.data.conversationId)
    expect(row).toMatchObject({ mailAddressId: catchAllId, behaviour: 'mail', spamAt: null })
    expect(row.firstResponseDueAt).toBeNull()
    expect(row.slaPolicyId).toBeNull()
    expect(await autoReplies(row.id)).toHaveLength(0)
  })

  it('prefers an exact address over the catch-all, whatever the recipient order', async () => {
    const { response } = await deliver({ recipient: `nobody-listed@${domain}, ${exactAddress}` })
    expect((await conversationRow(response.data.conversationId)).mailAddressId).toBe(exactId)
  })

  it('does not stretch a catch-all to subdomains', async () => {
    const { response } = await deliver({ recipient: `x@mail.${domain}` })
    expect(response.data).toMatchObject({ accepted: true, reason: 'no-matching-inbox' })
  })

  it('ignores a catch-all whose domain is being deleted', async () => {
    await db.update(projectMailDomain).set({ status: 'deleting' }).where(eq(projectMailDomain.id, domainId))
    try {
      const { response } = await deliver({ recipient: `late@${domain}` })
      expect(response.data).toMatchObject({ accepted: true, reason: 'no-matching-inbox' })
      // Exact addresses keep working.
      const exact = await deliver({ recipient: exactAddress })
      expect(exact.response.data).toMatchObject({ accepted: true, created: true })
    } finally {
      await db.update(projectMailDomain).set({ status: 'verified' }).where(eq(projectMailDomain.id, domainId))
    }
  })

  it('files a message flagged X-Mailgun-Sflag: Yes straight into Spam, with no auto-reply, SLA or automation', async () => {
    const { response } = await deliver({ recipient: exactAddress, fields: { 'X-Mailgun-Sflag': 'Yes' } })

    expect(response.data).toMatchObject({ accepted: true, created: true })
    const row = await conversationRow(response.data.conversationId)
    expect(row.spamAt).toBeInstanceOf(Date)
    expect(row).toMatchObject({ mailAddressId: exactId, behaviour: 'helpdesk', firstResponseDueAt: null })
    expect(await autoReplies(row.id)).toHaveLength(0)
    const [incoming] = await messagesOf(row.id)
    expect(incoming.metadata).toMatchObject({ spam: true })
    expect(automation.triggerAutomationEvent).not.toHaveBeenCalled()
  })

  it('reads a frogmail-verdicts spam FAIL as spam, and GRAY as not spam', async () => {
    const verdicts = (spam: string) => JSON.stringify({ spam, virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' })

    const fail = await deliver({ recipient: exactAddress, fields: { 'frogmail-verdicts': verdicts('FAIL') } })
    expect((await conversationRow(fail.response.data.conversationId)).spamAt).toBeInstanceOf(Date)

    const gray = await deliver({
      recipient: exactAddress,
      fields: { 'X-Mailgun-Sflag': 'No', 'frogmail-verdicts': verdicts('GRAY') },
    })
    const grayRow = await conversationRow(gray.response.data.conversationId)
    expect(grayRow.spamAt).toBeNull()
    expect(await autoReplies(grayRow.id)).toHaveLength(1)
  })

  it('restores a conversation from Trash when the customer replies, without changing its address or behaviour', async () => {
    const first = await deliver({ recipient: `trash-me@${domain}` })
    const conversationId = first.response.data.conversationId as string
    await db
      .update(conversation)
      .set({ deletedAt: new Date(), status: 'resolved' })
      .where(eq(conversation.id, conversationId))

    // The reply is addressed to the exact address, but threads by In-Reply-To.
    const reply = await deliver({ recipient: exactAddress, inReplyTo: first.messageId })

    expect(reply.response.data).toMatchObject({ accepted: true, created: false, conversationId })
    const row = await conversationRow(conversationId)
    expect(row).toMatchObject({ deletedAt: null, status: 'open', mailAddressId: catchAllId, behaviour: 'mail' })
    expect((await messagesOf(conversationId)).filter((m) => m.kind === 'incoming')).toHaveLength(2)
    expect(automation.triggerAutomationEvent).toHaveBeenLastCalledWith({ conversationId, trigger: 'message_created' })
  })

  it('keeps a conversation in Spam when the customer replies: appended quietly, not reopened', async () => {
    const first = await deliver({ recipient: exactAddress })
    const conversationId = first.response.data.conversationId as string
    const spamAt = new Date(Date.now() - 60_000)
    await db.update(conversation).set({ spamAt, status: 'resolved' }).where(eq(conversation.id, conversationId))
    automation.triggerAutomationEvent.mockClear()

    const reply = await deliver({ recipient: exactAddress, inReplyTo: first.messageId })

    expect(reply.response.data).toMatchObject({ accepted: true, created: false, conversationId })
    const row = await conversationRow(conversationId)
    expect(row.spamAt).toEqual(spamAt)
    expect(row.status).toBe('resolved')
    expect((await messagesOf(conversationId)).filter((m) => m.kind === 'incoming')).toHaveLength(2)
    expect(automation.triggerAutomationEvent).not.toHaveBeenCalled()
  })

  it('appends a spam reply to a normal conversation without reopening it or notifying', async () => {
    const first = await deliver({ recipient: exactAddress })
    const conversationId = first.response.data.conversationId as string
    await db.update(conversation).set({ status: 'resolved' }).where(eq(conversation.id, conversationId))
    const before = await conversationRow(conversationId)
    automation.triggerAutomationEvent.mockClear()

    const reply = await deliver({
      recipient: exactAddress,
      inReplyTo: first.messageId,
      fields: { 'X-Mailgun-Sflag': 'Yes' },
    })

    expect(reply.response.data).toMatchObject({ accepted: true, created: false, conversationId })
    const row = await conversationRow(conversationId)
    expect(row).toMatchObject({ status: 'resolved', spamAt: null })
    expect(row.lastCustomerReplyAt).toEqual(before.lastCustomerReplyAt)
    const incoming = (await messagesOf(conversationId)).filter((m) => m.kind === 'incoming')
    expect(incoming).toHaveLength(2)
    expect(incoming.some((m) => (m.metadata as { spam?: boolean } | null)?.spam === true)).toBe(true)
    expect(automation.triggerAutomationEvent).not.toHaveBeenCalled()
  })

  it('never threads a new message onto a Spam or Trash conversation by subject alone', async () => {
    const first = await deliver({ recipient: exactAddress, messageId: `subject-${runId}@sender.example.test` })
    const conversationId = first.response.data.conversationId as string
    await db.update(conversation).set({ spamAt: new Date() }).where(eq(conversation.id, conversationId))

    // Same contact, same subject ("Question <id>"), no threading headers.
    const { event } = callback({ recipient: exactAddress, messageId: `subject-${runId}@sender.example.test` })
    const payload = JSON.parse(event.rawBody.toString())
    payload['Message-Id'] = `<again-${runId}@sender.example.test>`
    payload['message-headers'] = JSON.stringify([['Date', new Date().toUTCString()]])
    payload.subject = `Re: Question subject-${runId}@sender.example.test`
    const response = await handler({ ...event, rawBody: Buffer.from(JSON.stringify(payload)) })

    expect(response.data).toMatchObject({ accepted: true, created: true })
    expect(response.data.conversationId).not.toBe(conversationId)
  })
})

describe('domain removal and catch-alls (real Postgres)', () => {
  it('removes the catch-all with its domain and keeps exact addresses', async () => {
    const { deleteSendingDomainRow } = await import('../../server/utils/sending-domain-poller')
    const otherDomainId = `domain_gone_${runId}`
    const otherDomain = `gone-${runId}.example.test`
    await db.insert(projectMailDomain).values({
      id: otherDomainId,
      projectId,
      domain: otherDomain,
      registrableDomain: otherDomain,
      status: 'verified',
      provider: 'mailgun',
      ownershipToken: 'tok',
    })
    await db.insert(projectMailAddress).values([
      { id: `gone_exact_${runId}`, inboxId, projectId, address: `hi@${otherDomain}`, domainId: otherDomainId },
      { id: `gone_catch_${runId}`, inboxId, projectId, address: `*@${otherDomain}`, domainId: otherDomainId },
    ])

    expect(await deleteSendingDomainRow({ id: otherDomainId })).toBe(true)

    const left = await db
      .select({ id: projectMailAddress.id, domainId: projectMailAddress.domainId })
      .from(projectMailAddress)
      .where(and(eq(projectMailAddress.projectId, projectId), like(projectMailAddress.address, `%@${otherDomain}`)))
    expect(left).toEqual([{ id: `gone_exact_${runId}`, domainId: null }])
  })
})
