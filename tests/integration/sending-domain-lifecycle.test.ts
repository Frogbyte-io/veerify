import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import { supportInbox, projectMailAddress, projectMailDomain } from '../../server/database/schema/support'
import {
  deleteSendingDomainRow,
  detachForeignAddresses,
  reconcileDirectRoutes,
  runSendingDomainPoll,
  suspendClaimForSenderRejection,
} from '../../server/utils/sending-domain-poller'
import { SendingDomainProviderError } from '../../server/services/sending-domains/types'

// Route handlers run for real against Postgres; only auth, rate limits, DNS and the
// mail provider are stubbed.
const stubs = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  query: {} as Record<string, unknown>,
  provider: null as unknown,
  responseStatus: undefined as number | undefined,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => stubs.params[name])
vi.stubGlobal('getQuery', () => stubs.query)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  setResponseStatus: (_event: unknown, code: number) => {
    stubs.responseStatus = code
  },
  setResponseHeader: () => undefined,
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({
  resolveSupportProjectRole: vi.fn(async () => ({ effectiveRole: 'admin', isProjectAdmin: true })),
}))
vi.mock('~/server/utils/project-access', () => ({
  requireProjectAdmin: vi.fn(async () => ({ id: 'project-1' })),
}))
vi.mock('~/server/utils/rate-limit', () => ({ requireRateLimit: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/validation', () => ({
  validateQuery: () => ({ force: true }),
  validateBody: vi.fn(),
}))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => stubs.provider }))
vi.mock('~/server/services/sending-domains/ownership', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/sending-domains/ownership')>(
    '~/server/services/sending-domains/ownership'
  )
  return { ...actual, checkOwnershipTxt: vi.fn(async () => 'valid'), checkDmarc: vi.fn(async () => null) }
})

const verifyRoute = (await import('../../server/api/support/projects/[projectId]/sending-domains/[id]/verify.post'))
  .default as unknown as (event: unknown) => Promise<{ data: { status: string } }>
const deleteRoute = (await import('../../server/api/support/projects/[projectId]/sending-domains/[id].delete'))
  .default as unknown as (event: unknown) => Promise<{ data: Record<string, unknown> }>

const run = randomUUID().slice(0, 8)
const orgId = `sdl_org_${run}`
const projectA = `sdl_project_a_${run}`
const projectB = `sdl_project_b_${run}`
const inboxA = `sdl_inbox_a_${run}`
const inboxB = `sdl_inbox_b_${run}`
const inboxB2 = `sdl_inbox_b2_${run}`
const savedEnv = { ...process.env }
const now = () => new Date()
const past = () => new Date(Date.now() - 60_000)
const future = (ms: number) => new Date(Date.now() + ms)
const DAY = 24 * 60 * 60 * 1000
const claimIds: string[] = []
let seq = 0
const fresh = () => `sdl${run}${seq++}.example.com`

const activeResult = (domain: string, extra: Record<string, unknown> = {}) => ({
  domain,
  state: 'active' as const,
  receivesMail: false,
  records: [],
  message: null,
  ...extra,
})

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: 'mailgun',
    accountKey: 'acct-1',
    capabilities: { register: true, verifyNow: true, remove: true, inboundRoutes: true, authorizesSubdomains: true },
    isConfigured: () => ({ configured: true, missing: [] as string[] }),
    register: vi.fn(async (domain: string) => ({
      ...activeResult(domain, { state: 'unverified' }),
      ownership: 'adopted',
    })),
    get: vi.fn(async (domain: string) => activeResult(domain)),
    verify: vi.fn(async (domain: string) => activeResult(domain)),
    remove: vi.fn(async () => ({ cleanup: null })),
    createInboundRoute: vi.fn(async () => ({ routeId: `route_${randomUUID()}` })),
    deleteInboundRoute: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function addClaim(
  projectId: string,
  domain: string,
  status: string,
  overrides: Partial<typeof projectMailDomain.$inferInsert> = {}
) {
  const id = `sdl_${randomUUID()}`
  claimIds.push(id)
  await db.insert(projectMailDomain).values({
    id,
    projectId,
    domain,
    registrableDomain: domain.split('.').slice(-2).join('.'),
    status,
    provider: 'mailgun',
    providerAccountKey: 'acct-1',
    ownershipToken: `tok_${randomUUID()}`,
    nextCheckAt: past(),
    ...overrides,
  })
  return id
}

async function addAddress(
  inboxId: string,
  address: string,
  overrides: Partial<typeof projectMailAddress.$inferInsert> = {}
) {
  const id = `sdl_addr_${randomUUID()}`
  const [owner] = await db
    .select({ projectId: supportInbox.projectId })
    .from(supportInbox)
    .where(eq(supportInbox.id, inboxId))
    .limit(1)
  await db
    .insert(projectMailAddress)
    .values({ id, inboxId, projectId: owner.projectId, address, kind: 'custom', ...overrides })
  return id
}

const claimRow = async (id: string) =>
  (await db.select().from(projectMailDomain).where(eq(projectMailDomain.id, id)))[0]

/** Poll exactly these rows (the shared claim queue also holds other suites' rows). */
function poll(ids: string[], provider: unknown, deps: Record<string, unknown> = {}) {
  const metrics: { name: string; fields: unknown }[] = []
  const batches = [ids]
  return runSendingDomainPoll({
    enabled: () => true,
    policy: () => 'project',
    provider: provider as never,
    claim: async () => {
      const batch = batches.shift()
      return batch ? db.select().from(projectMailDomain).where(inArray(projectMailDomain.id, batch)) : []
    },
    checkOwnership: async () => 'valid',
    checkDmarcRecord: async () => null,
    metric: (name: string, fields: unknown) => {
      metrics.push({ name, fields })
      return true
    },
    ...deps,
  }).then((summary) => ({ summary, metrics }))
}

beforeAll(async () => {
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  process.env.SUPPORT_CHANNEL_PROVIDER = 'mailgun'
  process.env.SUPPORT_MAILGUN_ACCOUNT_KEY = 'acct-1'
  delete process.env.SUPPORT_SENDING_DOMAIN_PROVIDER
  await db
    .insert(organization)
    .values({ id: orgId, name: 'SDL org', slug: `sdl-${run}`, createdAt: now(), updatedAt: now() })
  await db.insert(project).values(
    [projectA, projectB].map((id) => ({
      id,
      name: id,
      slug: id,
      organizationId: orgId,
      createdAt: now(),
      updatedAt: now(),
    }))
  )
  await db.insert(supportInbox).values(
    [
      { id: inboxA, projectId: projectA },
      { id: inboxB, projectId: projectB },
      { id: inboxB2, projectId: projectB },
    ].map(({ id, projectId }) => ({
      id,
      projectId,
      name: id,
      slug: id,
      emailAddress: `${id}@inbox.example.net`,
      createdAt: now(),
      updatedAt: now(),
    }))
  )
})

beforeEach(async () => {
  stubs.provider = makeProvider()
  stubs.responseStatus = undefined
  await db.delete(projectMailDomain).where(inArray(projectMailDomain.id, claimIds.splice(0)))
  await db.delete(projectMailAddress).where(inArray(projectMailAddress.inboxId, [inboxA, inboxB, inboxB2]))
  await db
    .update(supportInbox)
    .set({ emailAddress: null })
    .where(inArray(supportInbox.id, [inboxA, inboxB, inboxB2]))
})

afterAll(async () => {
  process.env = savedEnv
  await db.delete(projectMailDomain).where(inArray(projectMailDomain.id, claimIds))
  await db.delete(project).where(inArray(project.id, [projectA, projectB]))
  await db.delete(organization).where(eq(organization.id, orgId))
})

describe('verifying a claim detaches other projects (H2, M1)', () => {
  it('manual Verify now removes the other project address and From on the domain and its subdomains', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'pending', {
      expiresAt: future(7 * DAY),
      providerState: 'unverified',
    })
    await db
      .update(supportInbox)
      .set({ emailAddress: `Support@${domain.toUpperCase()}` })
      .where(eq(supportInbox.id, inboxB))
    await db
      .update(supportInbox)
      .set({ emailAddress: `help@eu.${domain}` })
      .where(eq(supportInbox.id, inboxB2))
    const foreign = await addAddress(inboxB, `support@${domain}`)
    const foreignSub = await addAddress(inboxB2, `help@eu.${domain}`)
    const unrelated = await addAddress(inboxB, `hello@other-${domain}`)
    const own = await addAddress(inboxA, `own@${domain}`)

    stubs.params = { projectId: projectA, id: claim }
    const res = await verifyRoute({})

    expect(res.data.status).toBe('verified')
    const left = await db
      .select({ id: projectMailAddress.id })
      .from(projectMailAddress)
      .where(inArray(projectMailAddress.id, [foreign, foreignSub, unrelated, own]))
    expect(left.map((r) => r.id).sort()).toEqual([unrelated, own].sort())
    const inboxes = await db
      .select({ id: supportInbox.id, emailAddress: supportInbox.emailAddress })
      .from(supportInbox)
      .where(inArray(supportInbox.id, [inboxB, inboxB2]))
    expect(inboxes.map((i) => i.emailAddress)).toEqual([null, null])
  })

  it('does not detach anything when the claim does not verify', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'pending', { expiresAt: future(7 * DAY) })
    stubs.provider = makeProvider({ verify: vi.fn(async (d: string) => activeResult(d, { state: 'unverified' })) })
    await db
      .update(supportInbox)
      .set({ emailAddress: `support@${domain}` })
      .where(eq(supportInbox.id, inboxB))
    const foreign = await addAddress(inboxB, `support@${domain}`)

    stubs.params = { projectId: projectA, id: claim }
    expect((await verifyRoute({})).data.status).toBe('pending')

    expect(await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, foreign))).toHaveLength(1)
    const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, inboxB))
    expect(inbox!.emailAddress).toBe(`support@${domain}`)
  })

  it('the poller detaches through the same path, and recovery from suspended detaches too', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'suspended', {
      verifiedAt: past(),
      expiresAt: future(10 * DAY),
      providerState: 'unverified',
    })
    await db
      .update(supportInbox)
      .set({ emailAddress: `support@${domain}` })
      .where(eq(supportInbox.id, inboxB))
    await addAddress(inboxB, `support@${domain}`)

    const { summary, metrics } = await poll([claim], stubs.provider)

    expect(summary.verified).toBe(1)
    expect((await claimRow(claim))!.status).toBe('verified')
    expect(await db.select().from(projectMailAddress).where(eq(projectMailAddress.inboxId, inboxB))).toEqual([])
    expect((await db.select().from(supportInbox).where(eq(supportInbox.id, inboxB)))[0]!.emailAddress).toBeNull()
    expect(metrics.map((m) => m.name)).toContain('support.sending_domain.address_detached')
  })

  it('rolls the verification back when the detach fails, so the claim is retried', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'pending', { expiresAt: future(7 * DAY) })
    const { summary } = await poll([claim], stubs.provider, {
      detach: async () => {
        throw new Error('boom')
      },
    })
    expect(summary.failed).toBe(1)
    const row = await claimRow(claim)
    expect(row!.status).toBe('pending')
    expect(row!.lastErrorCode).toBe('internal_error')
  })

  it('detachForeignAddresses never touches the claiming project', async () => {
    const domain = fresh()
    await db
      .update(supportInbox)
      .set({ emailAddress: `a@${domain}` })
      .where(eq(supportInbox.id, inboxA))
    await addAddress(inboxA, `a@${domain}`)
    expect(await detachForeignAddresses({ id: 'x', projectId: projectA, domain })).toBe(0)
    expect((await db.select().from(supportInbox).where(eq(supportInbox.id, inboxA)))[0]!.emailAddress).toBe(
      `a@${domain}`
    )
  })
})

describe('status machine on real rows', () => {
  it('keeps the suspension reason and starts the suspension clock', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'verified', { verifiedAt: past(), ownershipFailures: 2 })
    await poll([claim], stubs.provider, { checkOwnership: async () => 'invalid' })
    const row = await claimRow(claim)
    expect(row).toMatchObject({ status: 'suspended', lastErrorCode: 'ownership_missing' })
    expect(row!.lastError).toContain('ownership TXT')
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
  })

  it('keeps a created domain created through register and needs_register', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'provisioning', {
      providerOwnership: 'created',
      expiresAt: future(7 * DAY),
    })
    await poll([claim], stubs.provider)
    expect(await claimRow(claim)).toMatchObject({ status: 'pending', providerOwnership: 'created' })

    const lost = await addClaim(projectA, fresh(), 'pending', {
      providerOwnership: 'created',
      expiresAt: future(7 * DAY),
    })
    stubs.provider = makeProvider({ get: vi.fn(async () => null) })
    await poll([lost], stubs.provider, { batchSize: 1 })
    expect((await claimRow(lost))!.status).toBe('provisioning')
    await poll([lost], stubs.provider)
    expect(await claimRow(lost)).toMatchObject({ status: 'pending', providerOwnership: 'created' })
  })

  it('infers created when an adoption follows one of our own failed attempts', async () => {
    const claim = await addClaim(projectA, fresh(), 'failed', {
      providerOwnership: null,
      attemptCount: 2,
      expiresAt: future(7 * DAY),
    })
    await poll([claim], makeProvider())
    expect((await claimRow(claim))!.providerOwnership).toBe('created')
  })

  it('list-only provider: stays pending, runs the TXT check, and does not ping-pong', async () => {
    const claim = await addClaim(projectA, fresh(), 'pending', {
      provider: 'postmark',
      providerAccountKey: 'pm-1',
      providerOwnership: 'adopted',
      expiresAt: future(7 * DAY),
    })
    const provider = makeProvider({
      name: 'postmark',
      accountKey: 'pm-1',
      capabilities: {
        register: false,
        verifyNow: false,
        remove: false,
        inboundRoutes: false,
        authorizesSubdomains: false,
      },
      get: vi.fn(async () => null),
    })
    const checkOwnership = vi.fn(async () => 'valid' as const)
    const dmarc = { purpose: 'recommended', type: 'TXT', name: '_dmarc.x', value: 'v=DMARC1; p=none', status: 'valid' }
    await poll([claim], provider, { checkOwnership, checkDmarcRecord: async () => dmarc })
    const row = await claimRow(claim)
    expect(checkOwnership).toHaveBeenCalled()
    expect(row!.status).toBe('pending')
    expect(row!.dnsRecords.map((r) => r.purpose)).toEqual(['ownership', 'recommended'])
    expect(row!.dnsRecords[0]!.status).toBe('valid')
  })

  it('a suspended claim whose provider domain is gone re-registers instead of waiting for expiry', async () => {
    const claim = await addClaim(projectA, fresh(), 'suspended', {
      providerOwnership: 'created',
      verifiedAt: past(),
      expiresAt: future(3 * DAY),
    })
    const provider = makeProvider({ get: vi.fn(async () => null) })
    await poll([claim], provider)
    await poll([claim], provider)
    expect(provider.register).toHaveBeenCalledTimes(1)
    expect(await claimRow(claim)).toMatchObject({ status: 'pending', providerOwnership: 'created' })
  })

  it('expires suspended claims after their clock runs out', async () => {
    const claim = await addClaim(projectA, fresh(), 'suspended', { verifiedAt: past(), expiresAt: past() })
    const { summary } = await poll([claim], makeProvider())
    expect(summary.expired).toBe(1)
    expect(await claimRow(claim)).toBeUndefined()
  })

  it('aborts on the first rate limit and leaves later rows leased free', async () => {
    const [a, b] = [
      await addClaim(projectA, fresh(), 'pending', { expiresAt: future(7 * DAY) }),
      await addClaim(projectA, fresh(), 'pending', { expiresAt: future(7 * DAY) }),
    ]
    const provider = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 120)
      }),
    })
    const { summary } = await poll([a, b], provider)
    expect(summary.aborted).toBe('rate_limited')
    expect(provider.get).toHaveBeenCalledTimes(1)
  })
})

describe('guarded deletes (6e)', () => {
  it('expiry deletes only a row that is still expired and still in the status seen', async () => {
    const stillExpired = await addClaim(projectA, fresh(), 'pending', { expiresAt: past() })
    const reRegistered = await addClaim(projectA, fresh(), 'pending', { expiresAt: future(7 * DAY) })
    const verifiedMeanwhile = await addClaim(projectA, fresh(), 'verified', { expiresAt: null, verifiedAt: past() })

    expect(await deleteSendingDomainRow({ id: reRegistered, status: 'pending' }, { expiredBy: now() })).toBe(false)
    expect(await deleteSendingDomainRow({ id: verifiedMeanwhile, status: 'pending' }, { expiredBy: now() })).toBe(false)
    expect(await deleteSendingDomainRow({ id: stillExpired, status: 'pending' }, { expiredBy: now() })).toBe(true)
    expect(await claimRow(reRegistered)).toBeDefined()
    expect(await claimRow(verifiedMeanwhile)).toBeDefined()
  })

  it('the poller leaves an expiring row alone when a concurrent verify already moved it', async () => {
    const claim = await addClaim(projectA, fresh(), 'pending', { expiresAt: past() })
    const { summary } = await poll([claim], makeProvider(), {
      // The row was verified between the claim and the delete.
      deleteRow: async (row: { id: string; status: string }, opts: { expiredBy?: Date }) => {
        await db
          .update(projectMailDomain)
          .set({ status: 'verified', expiresAt: null, verifiedAt: now() })
          .where(eq(projectMailDomain.id, claim))
        return deleteSendingDomainRow(row as never, opts)
      },
    })
    expect(summary.expired).toBe(0)
    expect((await claimRow(claim))!.status).toBe('verified')
  })
})

describe('removal that cannot succeed (§5.3)', () => {
  it('releases a deleting row after a permanent refusal and asks the operator to clean up', async () => {
    const claim = await addClaim(projectA, fresh(), 'deleting', { providerOwnership: 'created' })
    const provider = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('unknown', 'refused', false)
      }),
    })
    const { summary, metrics } = await poll([claim], provider)
    expect(summary.deleted).toBe(1)
    expect(await claimRow(claim)).toBeUndefined()
    expect(metrics.map((m) => m.name)).toContain('support.sending_domain.operator_cleanup_required')
  })

  it('bounds the retries for a credential failure so the row cannot block the domain forever', async () => {
    const claim = await addClaim(projectA, fresh(), 'deleting', { providerOwnership: 'created' })
    const provider = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('unauthorized', 'bad key', false)
      }),
    })
    let passes = 0
    for (; passes < 30; passes++) {
      await db
        .update(projectMailDomain)
        .set({ nextCheckAt: past(), leaseExpiresAt: null })
        .where(eq(projectMailDomain.id, claim))
      const { summary } = await poll([claim], provider)
      if (summary.deleted) break
      expect(summary.aborted).toBe('provider_misconfigured')
      expect((await claimRow(claim))!.status).toBe('deleting')
    }
    expect(passes).toBeGreaterThan(1)
    expect(passes).toBeLessThan(30)
    expect(await claimRow(claim)).toBeUndefined()
  })
})

describe('busy rows (6d)', () => {
  it('refuses an admin delete with 409 DOMAIN_BUSY while a register holds the lease, then deletes after', async () => {
    const claim = await addClaim(projectA, fresh(), 'provisioning', { leaseExpiresAt: future(60_000) })
    stubs.params = { projectId: projectA, id: claim }
    await expect(deleteRoute({})).rejects.toMatchObject({ statusCode: 409, data: { error: { code: 'DOMAIN_BUSY' } } })
    expect((await claimRow(claim))!.status).toBe('provisioning')

    await db.update(projectMailDomain).set({ leaseExpiresAt: past() }).where(eq(projectMailDomain.id, claim))
    const res = await deleteRoute({})
    expect(res.data).toMatchObject({ deleted: true })
    expect(await claimRow(claim)).toBeUndefined()
  })
})

describe('direct-receiving routes reconcile (§9.2)', () => {
  it('retries failed routes and creates missing ones on the exact claimed domain only', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'verified', { verifiedAt: past(), receivesViaProvider: true })
    const failed = await addAddress(inboxA, `failed@${domain}`, { providerRouteStatus: 'failed' })
    const missing = await addAddress(inboxA, `Missing@${domain.toUpperCase()}`)
    const active = await addAddress(inboxA, `ok@${domain}`, {
      providerRouteId: 'route_existing',
      providerRouteStatus: 'active',
    })
    const subdomain = await addAddress(inboxA, `help@eu.${domain}`)
    const platform = await addAddress(inboxA, `plat-${run}@veerifymail.test`, { kind: 'platform' })
    const foreignProject = await addAddress(inboxB, `b@${domain}`)

    const provider = makeProvider()
    const result = await reconcileDirectRoutes({ id: claim, projectId: projectA, domain }, provider as never)

    expect(result).toEqual({ created: 2, failed: 0, misconfigured: false })
    expect(provider.createInboundRoute).toHaveBeenCalledTimes(2)
    const rows = await db
      .select()
      .from(projectMailAddress)
      .where(inArray(projectMailAddress.id, [failed, missing, active, subdomain, platform, foreignProject]))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(failed)).toMatchObject({ providerRouteStatus: 'active' })
    expect(byId.get(failed)!.providerRouteId).toMatch(/^route_/)
    expect(byId.get(missing)).toMatchObject({ providerRouteStatus: 'active' })
    expect(byId.get(active)).toMatchObject({ providerRouteId: 'route_existing' })
    for (const untouched of [subdomain, platform, foreignProject]) {
      expect(byId.get(untouched)).toMatchObject({ providerRouteId: null, providerRouteStatus: null })
    }
  })

  it('marks a route failed when creation fails, and reports a missing scope', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'verified', { verifiedAt: past(), receivesViaProvider: true })
    const addr = await addAddress(inboxA, `a@${domain}`)
    const flaky = makeProvider({
      createInboundRoute: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'down', true)
      }),
    })
    expect(await reconcileDirectRoutes({ id: claim, projectId: projectA, domain }, flaky as never)).toEqual({
      created: 0,
      failed: 1,
      misconfigured: false,
    })
    expect((await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, addr)))[0]).toMatchObject({
      providerRouteStatus: 'failed',
    })

    const noScope = makeProvider({
      createInboundRoute: vi.fn(async () => {
        throw new SendingDomainProviderError('missing_scope', 'routes', false)
      }),
    })
    const { metrics } = await poll(
      [claim],
      makeProvider({ get: vi.fn(async (d: string) => activeResult(d, { receivesMail: true })) }),
      {
        reconcileRoutes: (row: { id: string; projectId: string; domain: string }) =>
          reconcileDirectRoutes(row, noScope as never),
      }
    )
    expect(metrics.map((m) => m.name)).toContain('support.sending_domain.provider_misconfigured')
    expect((await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, addr)))[0]).toMatchObject({
      providerRouteStatus: 'failed',
    })
  })

  it('the daily verified pass runs the reconcile with the real function', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'verified', { verifiedAt: past(), receivesViaProvider: true })
    const addr = await addAddress(inboxA, `a@${domain}`, { providerRouteStatus: 'failed' })
    const provider = makeProvider({ get: vi.fn(async (d: string) => activeResult(d, { receivesMail: true })) })
    await poll([claim], provider)
    expect(provider.createInboundRoute).toHaveBeenCalledTimes(1)
    expect((await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, addr)))[0]).toMatchObject({
      providerRouteStatus: 'active',
    })
  })
})

describe('suspendClaimForSenderRejection (§14)', () => {
  it('suspends the verified claim covering the From, with the sender_rejected reason', async () => {
    const domain = fresh()
    const claim = await addClaim(projectA, domain, 'verified', { verifiedAt: past(), expiresAt: null })
    const metrics: { name: string; fields: unknown }[] = []
    const metric = (name: string, fields: unknown) => {
      metrics.push({ name, fields })
      return true
    }

    expect(
      await suspendClaimForSenderRejection(projectA, `Support@eu.${domain}`, '553 sender not allowed', {
        metric: metric as never,
      })
    ).toBe(true)
    const row = await claimRow(claim)
    expect(row).toMatchObject({ status: 'suspended', lastErrorCode: 'sender_rejected' })
    expect(row!.lastError).toContain('553')
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
    expect(metrics).toEqual([
      {
        name: 'support.sending_domain.suspended',
        fields: expect.objectContaining({ domainId: claim, reason: 'sender_rejected' }),
      },
    ])

    // Already suspended: nothing more to do.
    expect(await suspendClaimForSenderRejection(projectA, `support@${domain}`, 'again')).toBe(false)
  })

  it('does nothing for another project, an uncovered domain, or a pending claim', async () => {
    const domain = fresh()
    const verified = await addClaim(projectA, domain, 'verified', { verifiedAt: past() })
    const pendingDomain = fresh()
    const pending = await addClaim(projectA, pendingDomain, 'pending', { expiresAt: future(DAY) })

    expect(await suspendClaimForSenderRejection(projectB, `x@${domain}`, 'refused')).toBe(false)
    expect(await suspendClaimForSenderRejection(projectA, 'x@unclaimed.example.org', 'refused')).toBe(false)
    expect(await suspendClaimForSenderRejection(projectA, `x@${pendingDomain}`, 'refused')).toBe(false)
    expect((await claimRow(verified))!.status).toBe('verified')
    expect((await claimRow(pending))!.status).toBe('pending')
  })
})
