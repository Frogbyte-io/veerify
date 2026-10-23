import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { conversationMessage, supportOutboundDelivery } from '../../server/database/schema/support'
import {
  deleteOrganization,
  seedOrganization,
  seedQueuedDelivery,
  seedSendingDomain,
  seedTeamWithInbox,
  type SeededTeam,
} from './helpers/sender-seed'

/**
 * Retry endpoint and thread flags for blocked senders, against real Postgres.
 * Management is "off" (no env flag) with a claim present, which is the rollback
 * case: the retry must still refuse a sender that is not the team's.
 */

const provider = vi.hoisted(() => ({
  current: { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } },
}))
const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  teamId: '',
  conversationId: '',
  worker: vi.fn(async () => ({ processed: 0 })),
}))

vi.mock('../../server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))
vi.mock('../../server/utils/outbound-delivery', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runOutboundDeliveryWorker: state.worker,
}))
vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRouterParam: (_event: unknown, name: string) => state.params[name],
  getQuery: () => ({}),
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({
  requireConversationAccess: vi.fn(async () => ({ id: state.conversationId, teamId: state.teamId })),
}))
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => ({}))
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

const sendingDomains = await import('../../server/utils/sending-domains')
const { SENDER_DOMAIN_NOT_AUTHORIZED } = await import('../../server/utils/outbound-delivery')
const retry = (await import('../../server/api/support/conversations/[id]/messages/[messageId]/retry.post')).default
const list = (await import('../../server/api/support/conversations/[id]/messages/index.get')).default

const event = {} as never
const fresh = () => `r${randomUUID().replace(/-/g, '').slice(0, 12)}.com`
const savedEnv = { ...process.env }
const ownedDomain = fresh()
const foreignDomain = fresh()

let orgId: string
let teamA: SeededTeam
let teamB: SeededTeam

async function failedDelivery(seed: SeededTeam, from: string, lastError: string) {
  const queued = await seedQueuedDelivery(seed, from)
  await db
    .update(supportOutboundDelivery)
    .set({ status: 'failed', lastError, leaseExpiresAt: null })
    .where(eq(supportOutboundDelivery.id, queued.deliveryId))
  await db
    .update(conversationMessage)
    .set({ deliveryStatus: 'failed', deliveryError: lastError })
    .where(eq(conversationMessage.id, queued.messageId))
  return queued
}

function actAs(seed: SeededTeam, messageId = '') {
  state.teamId = seed.teamId
  state.conversationId = seed.conversationId
  state.params = { id: seed.conversationId, messageId }
}

async function rejection(promise: Promise<unknown>) {
  return (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { error?: { code?: string } } } | null
}

beforeAll(async () => {
  orgId = await seedOrganization('retry')
  teamA = await seedTeamWithInbox(orgId, 'retrya', `support@${ownedDomain}`)
  teamB = await seedTeamWithInbox(orgId, 'retryb', 'support@teamb.example.net')
  await seedSendingDomain({ teamId: teamA.teamId, domain: ownedDomain })
  await seedSendingDomain({ teamId: teamB.teamId, domain: foreignDomain })
})

afterAll(async () => {
  process.env = savedEnv
  await deleteOrganization(orgId)
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', '')
  vi.stubEnv('SUPPORT_SENDER_POLICY', '')
  sendingDomains.resetSenderPolicyCache()
})

describe('retry of a blocked outgoing reply', () => {
  it('answers 409 SENDER_NOT_VERIFIED while the stored sender is still unauthorized, and resets nothing', async () => {
    const queued = await failedDelivery(teamA, `support@${foreignDomain}`, SENDER_DOMAIN_NOT_AUTHORIZED)
    actAs(teamA, queued.messageId)

    const error = await rejection(retry(event))

    expect(error?.statusCode).toBe(409)
    expect(error?.data?.error?.code).toBe('SENDER_NOT_VERIFIED')
    const [delivery] = await db
      .select({ status: supportOutboundDelivery.status })
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.id, queued.deliveryId))
    expect(delivery.status).toBe('failed')
    expect(state.worker).not.toHaveBeenCalled()
  })

  it('retries once the sender is authorized, reporting no duplicate risk for a sender block', async () => {
    const queued = await failedDelivery(teamA, `support@${ownedDomain}`, SENDER_DOMAIN_NOT_AUTHORIZED)
    actAs(teamA, queued.messageId)

    const response = (await retry(event)) as { data: { retried: boolean; previousSubmissionAttempted: boolean } }

    expect(response.data).toEqual({ retried: true, previousSubmissionAttempted: false })
    expect(state.worker).toHaveBeenCalledTimes(1)
  })

  it('still reports a possible duplicate for any other failure', async () => {
    const queued = await failedDelivery(teamA, `support@${ownedDomain}`, 'connection reset')
    actAs(teamA, queued.messageId)

    const response = (await retry(event)) as { data: { previousSubmissionAttempted: boolean } }

    expect(response.data.previousSubmissionAttempted).toBe(true)
  })

  it('has no retry for a CSAT delivery (404), the thread marks it retryable: false', async () => {
    const queued = await failedDelivery(teamA, `support@${ownedDomain}`, 'connection reset')
    await db
      .update(supportOutboundDelivery)
      .set({ kind: 'csat' })
      .where(eq(supportOutboundDelivery.id, queued.deliveryId))
    actAs(teamA, queued.messageId)

    expect((await rejection(retry(event)))?.statusCode).toBe(404)

    const response = (await list(event)) as { data: { messages: Array<Record<string, unknown>> } }
    const message = response.data.messages.find((m) => m.id === queued.messageId)
    expect(message).toMatchObject({ deliveryStatus: 'failed', retryable: false })
  })
})

describe('thread delivery flags', () => {
  it('exposes deliveryError, senderBlocked and retryable per message', async () => {
    const blocked = await failedDelivery(teamB, `support@${ownedDomain}`, SENDER_DOMAIN_NOT_AUTHORIZED)
    const maybeAccepted = await failedDelivery(teamB, 'support@teamb.example.net', 'DELIVERY_ABANDONED')
    const pending = await seedQueuedDelivery(teamB, 'support@teamb.example.net')
    actAs(teamB)

    const response = (await list(event)) as { data: { messages: Array<Record<string, unknown>> } }
    const byId = new Map(response.data.messages.map((m) => [m.id, m]))

    expect(byId.get(blocked.messageId)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: SENDER_DOMAIN_NOT_AUTHORIZED,
      senderBlocked: true,
      retryable: true,
    })
    expect(byId.get(maybeAccepted.messageId)).toMatchObject({
      deliveryError: 'DELIVERY_ABANDONED',
      senderBlocked: false,
      retryable: true,
    })
    expect(byId.get(pending.messageId)).toMatchObject({ senderBlocked: false, retryable: false })
  })
})
