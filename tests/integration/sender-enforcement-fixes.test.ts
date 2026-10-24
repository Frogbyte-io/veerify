import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { user } from '../../server/database/schema/auth'
import { conversationMessage, supportSendingDomain } from '../../server/database/schema/support'
import {
  deleteOrganization,
  seedOrganization,
  seedQueuedDelivery,
  seedSendingDomain,
  seedProjectWithInbox,
  type SeededProject,
} from './helpers/sender-seed'

/**
 * Review fixes for the sender policy against real Postgres (design §4.4-4.5, §9.3):
 *
 * - H1: rolling management back (flag off / `legacy`) must not reopen
 *   cross-project sending while claims exist.
 * - H2: a header-routed provider (Postmark) refuses receiving addresses that are
 *   not on the project's own verified claim.
 * - L1: concurrent claims by one project cannot exceed the per-project limits.
 *
 * `server/utils/sending-domains` is REAL here. Only the provider and the channel
 * driver are replaced.
 */

const provider = vi.hoisted(() => ({
  current: { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } } as Record<
    string,
    unknown
  > | null,
}))
const driver = vi.hoisted(() => ({
  checkSendingAuthorization: vi.fn(async () => ({ status: 'authorized' }) as Record<string, unknown>),
}))
const metrics = vi.hoisted(() => ({ record: vi.fn() }))
const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: {} as Record<string, string>,
  inbox: {} as Record<string, unknown>,
  projectId: '',
}))

vi.mock('../../server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))
vi.mock('../../server/services/support-channels', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getConfiguredChannelDriver: () => ({
    name: 'mailgun',
    accountKey: 'acct',
    checkSendingAuthorization: driver.checkSendingAuthorization,
    buildDeliveryCorrelationHeaders: () => ({}),
  }),
}))
vi.mock('../../server/utils/support-observability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordSupportMetric: metrics.record,
}))
vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRouterParam: (_event: unknown, name: string) => state.params[name],
  readBody: async () => state.body,
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({
  requireInboxRole: vi.fn(async () => ({ ...state.inbox })),
  requireConversationAccess: vi.fn(async () => ({
    id: 'conversation-1',
    projectId: state.projectId,
    inboxId: state.inbox.id,
    contactId: 'contact-1',
    subject: 'Hi',
  })),
}))
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

const sendingDomains = await import('../../server/utils/sending-domains')
const { evaluateProjectSender, isSenderAllowedForProject } = await import('../../server/utils/sender-enforcement')
const { processOutboundDelivery, SENDER_DOMAIN_NOT_AUTHORIZED } = await import('../../server/utils/outbound-delivery')
const inboxUpdate = (await import('../../server/api/support/inboxes/[id].put')).default
const sendingStatus = (await import('../../server/api/support/inboxes/[id]/sending-status.get')).default
const messageCreate = (await import('../../server/api/support/conversations/[id]/messages/index.post')).default
const addressCreate = (await import('../../server/api/support/inboxes/[id]/addresses/index.post')).default

const event = {} as never
const run = randomUUID().slice(0, 8)
const fresh = () => `f${randomUUID().replace(/-/g, '').slice(0, 12)}.com`

let orgId: string
let projectA: SeededProject
let projectB: SeededProject
const domainA = fresh()
// Decided before this file inserts anything, so the legacy-without-claims block
// only runs against a database that really has no claims (a CI database does).
const claimsExistAtStart =
  (await db.select({ id: supportSendingDomain.id }).from(supportSendingDomain).limit(1)).length > 0

function actAs(seed: SeededProject, emailAddress: string, params: Record<string, string> = {}) {
  state.projectId = seed.projectId
  state.inbox = { id: seed.inboxId, projectId: seed.projectId, slug: seed.inboxSlug, emailAddress }
  state.params = { id: seed.inboxId, ...params }
}

async function rejection(promise: Promise<unknown>) {
  return (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { code?: string; error?: { code?: string } } } | null
}

const savedEnv = { ...process.env }

beforeAll(async () => {
  orgId = await seedOrganization('sfix')
  projectA = await seedProjectWithInbox(orgId, 'sfixa', `support@${domainA}`)
  projectB = await seedProjectWithInbox(orgId, 'sfixb', 'support@projectb.example.net')
})

afterAll(async () => {
  process.env = savedEnv
  await deleteOrganization(orgId)
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'mailgun')
  vi.stubEnv('SUPPORT_MAILGUN_ACCOUNT_KEY', 'acct')
  vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', '')
  vi.stubEnv('SUPPORT_SENDER_POLICY', '')
  provider.current = { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } }
  driver.checkSendingAuthorization.mockResolvedValue({ status: 'authorized' })
  sendingDomains.resetSenderPolicyCache()
})

describe.skipIf(claimsExistAtStart)('H1: flag off and no claims anywhere (legacy, unchanged)', () => {
  it('resolves to legacy and enforces nothing', async () => {
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('legacy')
    expect(await evaluateProjectSender(projectB.projectId, 'anyone@free-text.example')).toBeNull()
    expect(await isSenderAllowedForProject(projectB.projectId, 'anyone@free-text.example')).toBe(true)
  })

  it('lets inbox PUT, the outbox and sending-status behave exactly as before', async () => {
    actAs(projectB, 'support@projectb.example.net')
    state.body = { emailAddress: 'anyone@free-text.example' }
    await expect(inboxUpdate(event)).resolves.toMatchObject({ success: true })

    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'ok' })
    const queued = await seedQueuedDelivery(projectB, 'anyone@free-text.example')
    const result = await processOutboundDelivery(queued.claim, { sendEmail, getObject: vi.fn() })
    expect(result).toEqual({ outcome: 'sent' })
    expect(sendEmail).toHaveBeenCalledTimes(1)

    actAs(projectB, 'anyone@free-text.example')
    driver.checkSendingAuthorization.mockResolvedValue({ status: 'authorized' })
    const status = (await sendingStatus(event)) as { data: Record<string, any> }
    expect(status.data).toEqual({
      address: 'anyone@free-text.example',
      policy: 'legacy',
      authorization: { status: 'authorized', domain: null },
    })
    expect(driver.checkSendingAuthorization).toHaveBeenCalledTimes(1)
  })

  it('switches to project in this process as soon as a claim is created here, without waiting for the cache', async () => {
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('legacy')

    await db.insert(user).values({
      id: `sfix_user_${run}`,
      name: 'sfix',
      email: `sfix-${run}@example.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const created = await sendingDomains.createSendingDomainClaim({
      projectId: projectB.projectId,
      domain: fresh(),
      userId: `sfix_user_${run}`,
      provider: 'mailgun',
      providerAccountKey: 'acct',
    })

    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('project')
    // Leave the table as found, for the stale-cache test that follows.
    await db.delete(supportSendingDomain).where(eq(supportSendingDomain.id, created.id))
    await db.delete(user).where(eq(user.id, `sfix_user_${run}`))
  })

  it('still refuses another project domain on inbox PUT while this process holds a stale "no claims" cache', async () => {
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('legacy')
    // Another process created the claim: this process's cache still says "none".
    const claimed = fresh()
    await seedSendingDomain({ projectId: projectA.projectId, domain: claimed })
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('legacy')

    actAs(projectB, 'support@projectb.example.net')
    state.body = { emailAddress: `support@${claimed}` }
    const error = await rejection(inboxUpdate(event))
    expect(error?.statusCode).toBe(422)
    expect(error?.data?.error?.code).toBe('SENDER_DOMAIN_NOT_OWNED')
  })
})

describe('H1: flag off (or legacy) with claims present', () => {
  beforeAll(async () => {
    await seedSendingDomain({ projectId: projectA.projectId, domain: domainA })
  })

  it('resolves to project even with the flag off or SUPPORT_SENDER_POLICY=legacy', async () => {
    expect(sendingDomains.resolveSenderPolicy()).toBe('legacy')
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('project')
    vi.stubEnv('SUPPORT_SENDER_POLICY', 'legacy')
    expect(await sendingDomains.resolveEffectiveSenderPolicy()).toBe('project')
  })

  it('blocks a cross-project From at inbox PUT, including subdomains, and allows the owner', async () => {
    for (const address of [`support@${domainA}`, `help@mail.${domainA}`]) {
      actAs(projectB, 'support@projectb.example.net')
      state.body = { emailAddress: address }
      const error = await rejection(inboxUpdate(event))
      expect(error?.statusCode).toBe(422)
      expect(error?.data?.error?.code).toBe('SENDER_DOMAIN_NOT_OWNED')
    }

    actAs(projectA, 'old@elsewhere.example')
    state.body = { emailAddress: `new@${domainA}` }
    await expect(inboxUpdate(event)).resolves.toMatchObject({ success: true })
  })

  it('blocks the other project in every status of the claim, but not a look-alike domain', async () => {
    const pending = fresh()
    const deleting = fresh()
    await seedSendingDomain({ projectId: projectA.projectId, domain: pending, status: 'pending' })
    await seedSendingDomain({ projectId: projectA.projectId, domain: deleting, status: 'deleting' })

    for (const domain of [pending, deleting]) {
      expect(await isSenderAllowedForProject(projectB.projectId, `x@${domain}`)).toBe(false)
    }
    // Label-boundary matching: a name that merely ends with the claimed one is not under it.
    expect(await sendingDomains.isDomainClaimedByOtherProject(projectB.projectId, `x${domainA}`)).toBe(false)
    expect(await sendingDomains.isDomainClaimedByOtherProject(projectB.projectId, `mail.${domainA}`)).toBe(true)
  })

  it('blocks a cross-project From at reply (409 SENDER_NOT_VERIFIED) and writes nothing', async () => {
    actAs(projectB, `support@${domainA}`)
    state.body = { kind: 'outgoing', body: 'Hello there' }
    const before = await db.select({ id: conversationMessage.id }).from(conversationMessage)

    const error = await rejection(messageCreate(event))

    expect(error?.statusCode).toBe(409)
    expect(error?.data?.error?.code).toBe('SENDER_NOT_VERIFIED')
    const after = await db.select({ id: conversationMessage.id }).from(conversationMessage)
    expect(after.length).toBe(before.length)
  })

  it('blocks a cross-project From at the outbox final check, emitting the outbox block metric', async () => {
    const queued = await seedQueuedDelivery(projectB, `support@${domainA}`)
    const sendEmail = vi.fn()

    const result = await processOutboundDelivery(queued.claim, { sendEmail, getObject: vi.fn() })

    expect(result).toEqual({ outcome: 'failed', error: SENDER_DOMAIN_NOT_AUTHORIZED })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(metrics.record).toHaveBeenCalledWith('support.sending_domain.blocked', { reason: 'outbox' })

    const [message] = await db
      .select({ status: conversationMessage.deliveryStatus, error: conversationMessage.deliveryError })
      .from(conversationMessage)
      .where(eq(conversationMessage.id, queued.messageId))
    expect(message).toEqual({ status: 'failed', error: SENDER_DOMAIN_NOT_AUTHORIZED })
  })

  it('lets the owner send through the outbox', async () => {
    const queued = await seedQueuedDelivery(projectA, `support@${domainA}`)
    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'ok' })
    expect(await processOutboundDelivery(queued.claim, { sendEmail, getObject: vi.fn() })).toEqual({ outcome: 'sent' })
  })

  it('sending-status gives the same verdict for another project domain whether or not the provider verified it', async () => {
    const verdicts: unknown[] = []
    for (const providerVerdict of [{ status: 'authorized' }, { status: 'unauthorized' }, { status: 'unknown' }]) {
      driver.checkSendingAuthorization.mockResolvedValue(providerVerdict)
      actAs(projectB, `support@${domainA}`)
      verdicts.push(((await sendingStatus(event)) as { data: { authorization: unknown } }).data.authorization)
    }
    expect(driver.checkSendingAuthorization).not.toHaveBeenCalled()
    for (const verdict of verdicts) {
      expect(verdict).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    }
    expect(verdicts[0]).toEqual(verdicts[1])
    expect(verdicts[1]).toEqual(verdicts[2])
  })
})

describe('H2: receiving addresses on a provider that routes by header (Postmark)', () => {
  const ownDomain = fresh()
  const unclaimed = fresh()
  const otherProjectDomain = fresh()

  beforeAll(async () => {
    await seedSendingDomain({
      projectId: projectB.projectId,
      domain: ownDomain,
      provider: 'postmark',
      providerAccountKey: 'pm',
    })
    await seedSendingDomain({
      projectId: projectB.projectId,
      domain: fresh(),
      status: 'pending',
      provider: 'postmark',
      providerAccountKey: 'pm',
    })
    await seedSendingDomain({
      projectId: projectA.projectId,
      domain: otherProjectDomain,
      provider: 'postmark',
      providerAccountKey: 'pm',
    })
  })

  beforeEach(() => {
    vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'postmark')
    vi.stubEnv('SUPPORT_POSTMARK_ACCOUNT_KEY', 'pm')
    vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', 'true')
    provider.current = { name: 'postmark', accountKey: 'pm', capabilities: { authorizesSubdomains: false } }
  })

  it('refuses an unclaimed domain with 422 ADDRESS_DOMAIN_UNVERIFIED', async () => {
    actAs(projectB, 'support@projectb.example.net')
    state.body = { address: `support@${unclaimed}` }
    const error = await rejection(addressCreate(event))
    expect(error?.statusCode).toBe(422)
    expect(error?.data?.error?.code).toBe('ADDRESS_DOMAIN_UNVERIFIED')
  })

  it('refuses a domain that is only pending for the project', async () => {
    const [pending] = await db
      .select({ domain: supportSendingDomain.domain })
      .from(supportSendingDomain)
      .where(eq(supportSendingDomain.projectId, projectB.projectId))
    expect(pending).toBeTruthy()
    await expect(
      sendingDomains.assertReceivingAddressAllowed(projectB.projectId, `support@${unclaimed}`)
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it("still refuses another project's claimed domain with 409 ADDRESS_DOMAIN_CLAIMED", async () => {
    await expect(
      sendingDomains.assertReceivingAddressAllowed(projectB.projectId, `support@${otherProjectDomain}`)
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("accepts the project's own verified domain and its subdomains", async () => {
    await expect(
      sendingDomains.assertReceivingAddressAllowed(projectB.projectId, `support@${ownDomain}`)
    ).resolves.toBeUndefined()
    await expect(
      sendingDomains.assertReceivingAddressAllowed(projectB.projectId, `support@help.${ownDomain}`)
    ).resolves.toBeUndefined()
  })

  it('keeps unclaimed domains allowed on Mailgun/Frogmail (envelope routing)', async () => {
    vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'mailgun')
    vi.stubEnv('SUPPORT_MAILGUN_ACCOUNT_KEY', 'acct')
    provider.current = { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } }
    await expect(
      sendingDomains.assertReceivingAddressAllowed(projectB.projectId, `support@${unclaimed}`)
    ).resolves.toBeUndefined()
  })
})

describe('L1: concurrent claims by one project', () => {
  it('cannot exceed the pending limit by racing different domains', async () => {
    const orgIdLocal = await seedOrganization('sfixl1')
    const racer = await seedProjectWithInbox(orgIdLocal, 'sfixl1', 'support@racer.example.net')
    const userId = `sfixl1_user_${run}`
    await db.insert(user).values({
      id: userId,
      name: 'racer',
      email: `racer-${run}@example.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    try {
      const attempts = Array.from({ length: 8 }, () =>
        sendingDomains
          .createSendingDomainClaim({
            projectId: racer.projectId,
            domain: fresh(),
            userId,
            provider: 'mailgun',
            providerAccountKey: 'acct',
          })
          .then(
            () => 'ok' as const,
            (error: { data?: { code?: string } }) => error.data?.code ?? 'error'
          )
      )
      const results = await Promise.all(attempts)

      const created = results.filter((r) => r === 'ok').length
      expect(created).toBe(3) // MAX_PENDING_PER_PROJECT
      expect(results.filter((r) => r === 'PENDING_LIMIT_REACHED')).toHaveLength(5)
      const rows = await db
        .select()
        .from(supportSendingDomain)
        .where(eq(supportSendingDomain.projectId, racer.projectId))
      expect(rows).toHaveLength(3)
    } finally {
      await deleteOrganization(orgIdLocal)
      await db.delete(user).where(eq(user.id, userId))
    }
  })
})
