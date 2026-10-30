import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import {
  conversation,
  conversationMessage,
  conversationReadState,
  conversationStatusEvent,
  projectMailAddress,
  slaPolicy,
  slaTarget,
  supportOutboundDelivery,
} from '../../server/database/schema/support'
import {
  deleteOrganization,
  seedOrganization,
  seedProjectWithInbox,
  seedSendingDomain,
  type SeededProject,
} from './helpers/sender-seed'

/**
 * The inbox redesign API against a real database: the `inbox` and `snoozed`
 * views and the unread/breaching/per-address counts, switching a conversation
 * between plain mail and a support case (PATCH, and with a reply), choosing the
 * address a reply is sent from, resolving with a reply, and `canSendFrom` on
 * the address list.
 *
 * Authentication and inbox access are stubbed (they have their own suites).
 */

const state = vi.hoisted(() => ({
  userId: '',
  params: {} as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  events: [] as Record<string, unknown>[],
}))
const senderPolicy = vi.hoisted(() => ({ allow: vi.fn(async (..._args: unknown[]) => true) }))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async () => ({ user: { id: state.userId, name: 'Agent' } }),
}))
vi.mock('~/server/utils/support-access', async () => {
  const { db } = await import('../../server/database/drizzle')
  const { conversation, supportInbox } = await import('../../server/database/schema/support')
  const { eq } = await import('drizzle-orm')
  return {
    requireConversationAccess: async (id: string) => {
      const [row] = await db.select().from(conversation).where(eq(conversation.id, id)).limit(1)
      if (!row) throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      return row
    },
    requireInboxAccess: async (id: string) => {
      const [row] = await db.select().from(supportInbox).where(eq(supportInbox.id, id)).limit(1)
      if (!row) throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      return row
    },
  }
})
vi.mock('~/server/utils/support-realtime', () => ({
  publishConversationEvent: async (event: Record<string, unknown>) => void state.events.push(event),
}))
// The project sender policy has its own suites; here it only has to be consulted.
vi.mock('~/server/utils/sender-enforcement', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isSenderAllowedForProject: senderPolicy.allow,
}))
vi.mock('~/server/utils/automation-engine', () => ({ triggerAutomationEvent: async () => undefined }))
vi.mock('~/server/utils/outbound-delivery', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runOutboundDeliveryWorker: async () => undefined,
}))

const { applyBehaviourSwitch, planBehaviourSwitch } = await import('../../server/utils/conversation-update')
const { commitMessageWithAttachments } = await import('../../server/utils/support-attachment-finalization')
const listHandler = (await import('../../server/api/support/conversations/index.get')).default
const patchHandler = (await import('../../server/api/support/conversations/[id].patch')).default
const messageHandler = (await import('../../server/api/support/conversations/[id]/messages/index.post')).default
const addressesHandler = (await import('../../server/api/support/inboxes/[id]/addresses/index.get')).default

type Handler = (event: never) => Promise<{ data: Record<string, any> }>
const call = (handler: unknown, input: { params?: Record<string, string>; body?: unknown; query?: object }) => {
  state.params = input.params ?? {}
  state.body = input.body
  state.query = (input.query ?? {}) as Record<string, unknown>
  return (handler as Handler)({} as never)
}

async function rejection(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { error?: { message?: string } } } | null
  expect(error, 'expected a rejection').not.toBeNull()
  return { statusCode: error?.statusCode, message: error?.data?.error?.message }
}

const run = randomUUID().slice(0, 8)
const verifiedDomain = `redesign-${run}.example.test`
const unverifiedDomain = `unverified-${run}.example.test`

let orgId: string
let seed: SeededProject
let displayCounter = 100
let policyId: string

async function addAddress(
  address: string,
  values: { kind?: string; inboxId?: string; behaviour?: string; domainId?: string | null } = {}
) {
  const id = `redesign_addr_${randomUUID()}`
  await db.insert(projectMailAddress).values({
    id,
    inboxId: values.inboxId ?? seed.inboxId,
    projectId: seed.projectId,
    address,
    kind: values.kind ?? 'custom',
    behaviour: values.behaviour ?? 'helpdesk',
    domainId: values.domainId ?? null,
  })
  return id
}

async function addConversation(values: Partial<typeof conversation.$inferInsert> = {}) {
  const id = `redesign_conv_${randomUUID()}`
  const now = new Date()
  await db.insert(conversation).values({
    id,
    inboxId: seed.inboxId,
    projectId: seed.projectId,
    contactId: seed.contactId,
    displayId: ++displayCounter,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...values,
  })
  return id
}

const getConversation = async (id: string) =>
  (await db.select().from(conversation).where(eq(conversation.id, id)).limit(1))[0]
const activityBodies = async (id: string) =>
  (
    await db
      .select({ body: conversationMessage.body })
      .from(conversationMessage)
      .where(and(eq(conversationMessage.conversationId, id), eq(conversationMessage.kind, 'activity')))
      .orderBy(asc(conversationMessage.createdAt))
  ).map((row) => row.body)

beforeAll(async () => {
  vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'mailgun')
  vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', '')
  orgId = await seedOrganization('redesign')
  seed = await seedProjectWithInbox(orgId, 'redesign', `support@${verifiedDomain}`)
  state.userId = seed.userId
  await seedSendingDomain({ projectId: seed.projectId, domain: verifiedDomain })
  await seedSendingDomain({ projectId: seed.projectId, domain: unverifiedDomain, status: 'pending' })

  policyId = `redesign_sla_${run}`
  await db.insert(slaPolicy).values({
    id: policyId,
    projectId: seed.projectId,
    name: 'Default',
    conditions: {},
    escalation: {},
    isDefault: true,
  })
  await db
    .insert(slaTarget)
    .values({ id: `redesign_target_${run}`, slaPolicyId: policyId, metric: 'first_response', targetMinutes: 60 })
})

beforeEach(() => {
  state.events = []
  senderPolicy.allow.mockClear()
  senderPolicy.allow.mockResolvedValue(true)
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await deleteOrganization(orgId)
})

describe('GET /api/support/conversations views and counts', () => {
  let addressA: string
  let addressB: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    // A separate inbox's worth of data is not needed: every row below is on this inbox,
    // and the views are asserted by id so the seeded conversation 1 does not interfere.
    addressA = await addAddress(`a@${verifiedDomain}`)
    addressB = await addAddress(`b@${verifiedDomain}`)
    const soon = new Date(Date.now() + 20 * 60_000)
    ids.openUnassignedA = await addConversation({ mailAddressId: addressA })
    ids.pendingMineA = await addConversation({
      mailAddressId: addressA,
      status: 'pending',
      assigneeUserId: seed.userId,
    })
    ids.openReadB = await addConversation({ mailAddressId: addressB })
    ids.snoozed = await addConversation({ mailAddressId: addressB, status: 'snoozed' })
    ids.resolved = await addConversation({ mailAddressId: addressA, status: 'resolved' })
    ids.breaching = await addConversation({ mailAddressId: addressB, firstResponseDueAt: soon })
    ids.spam = await addConversation({ mailAddressId: addressA, spamAt: new Date() })
    ids.noAddress = await addConversation({})
    // The agent has read this one.
    await db.insert(conversationReadState).values({
      conversationId: ids.openReadB,
      userId: seed.userId,
      lastReadAt: new Date(Date.now() + 60_000),
    })
  })

  const list = (query: Record<string, unknown>) =>
    call(listHandler, { query: { inboxId: seed.inboxId, limit: 100, ...query } })
  const idsOf = (result: { data: Record<string, any> }) =>
    (result.data.conversations as { id: string }[]).map((row) => row.id)

  it('lists open and pending conversations in the inbox view, whoever they are assigned to', async () => {
    const found = idsOf(await list({ view: 'inbox' }))
    expect(found).toEqual(
      expect.arrayContaining([
        ids.openUnassignedA,
        ids.pendingMineA,
        ids.openReadB,
        ids.breaching,
        ids.noAddress,
        seed.conversationId,
      ])
    )
    expect(found).not.toContain(ids.snoozed)
    expect(found).not.toContain(ids.resolved)
    expect(found).not.toContain(ids.spam)
  })

  it('lists only snoozed conversations in the snoozed view', async () => {
    expect(idsOf(await list({ view: 'snoozed' }))).toEqual([ids.snoozed])
  })

  it('keeps the existing views', async () => {
    expect(idsOf(await list({ view: 'resolved' }))).toEqual([ids.resolved])
    expect(idsOf(await list({ view: 'assigned-to-me' }))).toEqual([ids.pendingMineA])
    expect(idsOf(await list({ view: 'breaching-soon' }))).toEqual([ids.breaching])
    expect(idsOf(await list({ view: 'unassigned' }))).not.toContain(ids.pendingMineA)
    expect(idsOf(await list({ view: 'all' }))).toEqual(expect.arrayContaining([ids.snoozed, ids.resolved]))
  })

  it('counts unread open or pending conversations, breaching ones, and unread per address', async () => {
    const { unreadCounts } = (await list({ view: 'inbox' })).data
    // Open or pending, unread by this agent: the seeded one, openUnassignedA, pendingMineA,
    // breaching and noAddress (openReadB is read).
    expect(unreadCounts.inbox).toBe(5)
    expect(unreadCounts.assignedToMe).toBe(1)
    expect(unreadCounts.unassigned).toBe(4)
    expect(unreadCounts.breachingSoon).toBe(1)
    expect(unreadCounts.byAddress).toEqual({ [addressA]: 2, [addressB]: 1 })
  })

  it('counts breaching conversations whether or not they are read', async () => {
    await db.insert(conversationReadState).values({
      conversationId: ids.breaching,
      userId: seed.userId,
      lastReadAt: new Date(Date.now() + 60_000),
    })
    const { unreadCounts } = (await list({ view: 'inbox' })).data
    expect(unreadCounts.breachingSoon).toBe(1)
    expect(unreadCounts.inbox).toBe(4)
    await db
      .delete(conversationReadState)
      .where(
        and(eq(conversationReadState.conversationId, ids.breaching), eq(conversationReadState.userId, seed.userId))
      )
  })

  it('scopes the counts to one address but never the per-address map', async () => {
    const { unreadCounts, conversations } = (await list({ view: 'inbox', mailAddressId: addressA })).data
    expect((conversations as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [ids.openUnassignedA, ids.pendingMineA].sort()
    )
    expect(unreadCounts.inbox).toBe(2)
    expect(unreadCounts.assignedToMe).toBe(1)
    expect(unreadCounts.unassigned).toBe(1)
    expect(unreadCounts.breachingSoon).toBe(0)
    expect(unreadCounts.byAddress).toEqual({ [addressA]: 2, [addressB]: 1 })

    const other = (await list({ view: 'inbox', mailAddressId: addressB })).data.unreadCounts
    expect(other.breachingSoon).toBe(1)
    expect(other.inbox).toBe(1)
  })
})

describe('PATCH /api/support/conversations/[id] behaviour', () => {
  it('turns plain mail into a support case: SLA assigned, case number kept, activity written', async () => {
    const id = await addConversation({ behaviour: 'mail' })
    const before = await getConversation(id)
    expect(before.slaPolicyId).toBeNull()

    const result = await call(patchHandler, { params: { id }, body: { behaviour: 'helpdesk' } })
    expect(result.data.changed).toBe(true)

    const after = await getConversation(id)
    expect(after.behaviour).toBe('helpdesk')
    expect(after.slaPolicyId).toBe(policyId)
    expect(after.firstResponseDueAt).toBeInstanceOf(Date)
    expect(after.displayId).toBe(before.displayId)
    expect(await activityBodies(id)).toEqual(['Turned this into a support case.'])
    expect(state.events).toEqual([expect.objectContaining({ type: 'conversation.updated', conversationId: id })])
  })

  it('turns a support case into plain mail: SLA cleared, case number kept, and back again', async () => {
    const id = await addConversation({
      behaviour: 'helpdesk',
      slaPolicyId: policyId,
      firstResponseDueAt: new Date(Date.now() + 3_600_000),
      nextResponseDueAt: new Date(Date.now() + 3_600_000),
      resolutionDueAt: new Date(Date.now() + 7_200_000),
      slaPausedAt: new Date(),
    })
    const before = await getConversation(id)

    await call(patchHandler, { params: { id }, body: { behaviour: 'mail' } })
    const asMail = await getConversation(id)
    expect(asMail).toMatchObject({
      behaviour: 'mail',
      slaPolicyId: null,
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      resolutionDueAt: null,
      slaPausedAt: null,
      displayId: before.displayId,
    })
    expect(await activityBodies(id)).toEqual(['Turned this into plain mail.'])

    await call(patchHandler, { params: { id }, body: { behaviour: 'helpdesk' } })
    const again = await getConversation(id)
    expect(again.displayId).toBe(before.displayId)
    expect(again.slaPolicyId).toBe(policyId)
    expect(await activityBodies(id)).toEqual(['Turned this into plain mail.', 'Turned this into a support case.'])
  })

  it('does nothing, and writes no activity, when the type is already that', async () => {
    const id = await addConversation({ behaviour: 'helpdesk' })
    const result = await call(patchHandler, { params: { id }, body: { behaviour: 'helpdesk' } })
    expect(result.data.changed).toBe(false)
    expect(await activityBodies(id)).toEqual([])
    expect(state.events).toEqual([])
  })

  it('rejects an unknown type', async () => {
    const id = await addConversation()
    expect((await rejection(call(patchHandler, { params: { id }, body: { behaviour: 'ticket' } }))).statusCode).toBe(
      400
    )
  })
})

describe('POST /api/support/conversations/[id]/messages reply options', () => {
  let customAddress: string
  let platformAddress: string
  let catchAllAddress: string
  let unverifiedAddress: string
  let otherInboxAddress: string
  let otherInboxId: string

  beforeAll(async () => {
    customAddress = await addAddress(`sales@${verifiedDomain}`)
    platformAddress = await addAddress(`fwd-${run}@platform.example.test`, { kind: 'platform' })
    catchAllAddress = await addAddress(`*@${verifiedDomain}`)
    unverifiedAddress = await addAddress(`hi@${unverifiedDomain}`)
    otherInboxId = `redesign_inbox2_${randomUUID()}`
    const { supportInbox } = await import('../../server/database/schema/support')
    await db.insert(supportInbox).values({
      id: otherInboxId,
      projectId: seed.projectId,
      name: 'Other',
      slug: `other-${run}`,
      emailAddress: `other@${verifiedDomain}`,
    })
    otherInboxAddress = await addAddress(`other-addr@${verifiedDomain}`, { inboxId: otherInboxId })
  })

  const send = (id: string, body: Record<string, unknown>) =>
    call(messageHandler, { params: { id }, body: { kind: 'outgoing', body: 'Hello', ...body } })
  const deliveryFor = async (messageId: string) =>
    (await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.messageId, messageId)))[0]

  it('sends from the chosen address', async () => {
    const id = await addConversation()
    const result = await send(id, { fromAddressId: customAddress })
    expect(result.data.resolved).toBe(false)
    const delivery = await deliveryFor(result.data.message.id)
    expect(JSON.stringify(delivery.payload)).toContain(`sales@${verifiedDomain}`)
    expect(senderPolicy.allow).toHaveBeenCalledWith(seed.projectId, `sales@${verifiedDomain}`)
  })

  it('still applies the sender policy to the chosen address', async () => {
    senderPolicy.allow.mockResolvedValue(false)
    const id = await addConversation()
    const error = await rejection(send(id, { fromAddressId: customAddress, behaviour: 'mail' }))
    expect(error.statusCode).toBe(409)
    expect((await getConversation(id)).behaviour).toBe('helpdesk')
  })

  it('sends from the default address when none is chosen', async () => {
    const id = await addConversation()
    const result = await send(id, {})
    const delivery = await deliveryFor(result.data.message.id)
    expect(JSON.stringify(delivery.payload)).toContain(`support@${verifiedDomain}`)
    expect(JSON.stringify(delivery.payload)).not.toContain(`sales@${verifiedDomain}`)
  })

  it.each([
    ['an unknown address', () => 'does-not-exist'],
    ['an address of another inbox', () => otherInboxAddress],
    ['a platform forwarding address', () => platformAddress],
    ['a catch-all address', () => catchAllAddress],
    ['an address on an unverified domain', () => unverifiedAddress],
  ])('rejects %s with 400 and sends nothing', async (_label, pick) => {
    const id = await addConversation({ behaviour: 'mail' })
    const error = await rejection(send(id, { fromAddressId: pick(), behaviour: 'helpdesk' }))
    expect(error.statusCode).toBe(400)
    expect(error.message).toBeTruthy()
    const messages = await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, id))
    expect(messages).toEqual([])
    expect((await getConversation(id)).behaviour).toBe('mail')
  })

  it('rejects fromAddressId, behaviour and resolve on a note', async () => {
    const id = await addConversation()
    for (const extra of [{ fromAddressId: customAddress }, { behaviour: 'mail' }, { resolve: true }]) {
      const error = await rejection(
        call(messageHandler, { params: { id }, body: { kind: 'note', body: 'x', ...extra } })
      )
      expect(error.statusCode).toBe(400)
    }
    expect((await getConversation(id)).status).toBe('open')
  })

  it('switches the type with the reply, assigning the SLA and logging it', async () => {
    const id = await addConversation({ behaviour: 'mail' })
    const before = await getConversation(id)
    const result = await send(id, { behaviour: 'helpdesk' })
    const after = await getConversation(id)
    expect(after).toMatchObject({ behaviour: 'helpdesk', slaPolicyId: policyId, displayId: before.displayId })
    expect(after.firstResponseAt).toBeInstanceOf(Date)
    expect(await activityBodies(id)).toContain('Turned this into a support case.')
    expect(result.data.message.kind).toBe('outgoing')
    expect(state.events.map((e) => e.type)).toEqual(expect.arrayContaining(['conversation.updated', 'message.created']))
  })

  it('switches to plain mail with the reply and clears the SLA', async () => {
    const id = await addConversation({
      behaviour: 'helpdesk',
      slaPolicyId: policyId,
      firstResponseDueAt: new Date(Date.now() + 3_600_000),
    })
    await send(id, { behaviour: 'mail' })
    expect(await getConversation(id)).toMatchObject({ behaviour: 'mail', slaPolicyId: null, firstResponseDueAt: null })
  })

  it('leaves the type alone when the reply cannot be committed', async () => {
    const id = await addConversation({ behaviour: 'mail' })
    const error = await rejection(send(id, { behaviour: 'helpdesk', attachments: [{ uploadId: 'missing-upload' }] }))
    expect(error.statusCode).toBeGreaterThanOrEqual(400)
    expect((await getConversation(id)).behaviour).toBe('mail')
    expect(await activityBodies(id)).toEqual([])
  })

  it('commits nothing, not even the type switch, when the commit transaction fails after it', async () => {
    const id = await addConversation({ behaviour: 'mail' })
    const existing = await getConversation(id)
    const plan = await planBehaviourSwitch(existing, 'helpdesk', new Date())
    expect(plan).not.toBeNull()
    await expect(
      commitMessageWithAttachments({
        reservation: [],
        conversationId: id,
        userId: seed.userId,
        existingConversation: existing,
        outgoing: null,
        beforeMessage: async (tx) => {
          await applyBehaviourSwitch(tx, existing, plan!, seed.userId, new Date())
          throw new Error('boom')
        },
        message: {
          id: `redesign_msg_${randomUUID()}`,
          kind: 'note',
          body: 'x',
          bodyHtml: null,
          isPrivate: true,
          channelMessageId: null,
          inReplyTo: null,
          channelHeaders: null,
          deliveryStatus: 'delivered',
        },
      })
    ).rejects.toThrow('boom')
    expect((await getConversation(id)).behaviour).toBe('mail')
    expect(await activityBodies(id)).toEqual([])
  })

  it('resolves after the reply like a PATCH to resolved', async () => {
    const id = await addConversation()
    const result = await send(id, { resolve: true })
    expect(result.data.resolved).toBe(true)
    const after = await getConversation(id)
    expect(after.status).toBe('resolved')
    expect(after.resolvedAt).toBeInstanceOf(Date)
    expect(await activityBodies(id)).toEqual(expect.arrayContaining(['Status changed from open to resolved.']))
    const events = await db.select().from(conversationStatusEvent).where(eq(conversationStatusEvent.conversationId, id))
    expect(events).toEqual([expect.objectContaining({ fromStatus: 'open', toStatus: 'resolved' })])
    const messages = await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, id))
    expect(messages.filter((m) => m.kind === 'outgoing')).toHaveLength(1)
  })

  it('does not resolve when resolve is absent, and reports an already resolved conversation as not changed', async () => {
    const id = await addConversation()
    expect((await send(id, {})).data.resolved).toBe(false)
    expect((await getConversation(id)).status).toBe('open')

    const resolvedId = await addConversation({ status: 'resolved' })
    expect((await send(resolvedId, { resolve: true })).data.resolved).toBe(false)
  })

  it('combines a type switch, a chosen address and resolve in one request', async () => {
    const id = await addConversation({ behaviour: 'mail' })
    const result = await send(id, { behaviour: 'helpdesk', fromAddressId: customAddress, resolve: true })
    expect(result.data.resolved).toBe(true)
    expect(await getConversation(id)).toMatchObject({ behaviour: 'helpdesk', status: 'resolved' })
    expect(JSON.stringify((await deliveryFor(result.data.message.id)).payload)).toContain(`sales@${verifiedDomain}`)
  })
})

describe('GET /api/support/inboxes/[id]/addresses', () => {
  it('says which addresses a reply can be sent from, and returns the inbox sending address', async () => {
    const customId = await addAddress(`canSend-${run}@${verifiedDomain}`.toLowerCase())
    const catchAllId = await addAddress(`*@${unverifiedDomain}`)
    const platformId = await addAddress(`plat-${run}@platform.example.test`, { kind: 'platform' })
    const unverifiedId = await addAddress(`nope-${run}@${unverifiedDomain}`)
    const result = await call(addressesHandler, { params: { id: seed.inboxId } })

    expect(result.data.inboxSendingAddress).toBe(`support@${verifiedDomain}`)
    const byId = new Map((result.data.addresses as { id: string; canSendFrom: boolean }[]).map((a) => [a.id, a]))
    expect(byId.get(customId)).toMatchObject({ canSendFrom: true, isCatchAll: false })
    expect(byId.get(catchAllId)?.canSendFrom).toBe(false)
    expect(byId.get(platformId)?.canSendFrom).toBe(false)
    expect(byId.get(unverifiedId)?.canSendFrom).toBe(false)
    for (const address of byId.values()) expect(typeof address.canSendFrom).toBe('boolean')
  })

  it('returns a null sending address for an inbox without one', async () => {
    const { supportInbox } = await import('../../server/database/schema/support')
    const inboxId = `redesign_inbox3_${randomUUID()}`
    await db
      .insert(supportInbox)
      .values({ id: inboxId, projectId: seed.projectId, name: 'Bare', slug: `bare-${run}`, emailAddress: null })
    const result = await call(addressesHandler, { params: { id: inboxId } })
    expect(result.data).toEqual({ addresses: [], inboxSendingAddress: null })
  })
})
