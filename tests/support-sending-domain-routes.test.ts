import { beforeEach, describe, expect, it, vi } from 'vitest'

// WP1/WP2 modules are not part of this branch; every collaborator is mocked.
const state = vi.hoisted(() => ({
  params: { projectId: 'project-1', id: 'sd-1' } as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  enabled: true,
  isAdmin: true,
  supportRole: 'admin' as string | null,
  row: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  inboxes: [] as { id: string; name: string; emailAddress: string | null }[],
  responseStatus: undefined as number | undefined,
  responseHeaders: {} as Record<string, string>,
  markedRows: [] as Record<string, unknown>[],
  updateSets: [] as Record<string, unknown>[],
}))

const lease = vi.hoisted(() => ({
  acquireSendingDomainLease: vi.fn(async () => true),
  releaseSendingDomainLease: vi.fn(async () => undefined),
}))

const provider = vi.hoisted(() => ({
  name: 'mailgun',
  accountKey: 'acct',
  capabilities: { register: true, verifyNow: true, remove: true, inboundRoutes: true, authorizesSubdomains: true },
  isConfigured: vi.fn(() => ({ configured: true, missing: [] as string[] })),
  register: vi.fn(),
  get: vi.fn(),
  verify: vi.fn(),
  remove: vi.fn(),
}))

const access = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(async () => ({ id: 'tm-1', role: 'admin' })),
  resolveSupportProjectRole: vi.fn(async () =>
    state.supportRole ? { effectiveRole: state.supportRole, isProjectAdmin: state.isAdmin } : null
  ),
}))

const claims = vi.hoisted(() => ({
  createSendingDomainClaim: vi.fn(),
  getProjectSendingDomain: vi.fn(),
  listProjectSendingDomains: vi.fn(),
}))

const poller = vi.hoisted(() => ({
  saveSendingDomainPatch: vi.fn(async () => true),
  deleteSendingDomainRow: vi.fn(async () => undefined),
}))

const webhooks = vi.hoisted(() => ({ syncDeliveryWebhooks: vi.fn(async () => ({ status: 'ensured' })) }))

const rateLimit = vi.hoisted(() => ({ requireRateLimit: vi.fn(async () => undefined) }))
const mailLimits = vi.hoisted(() => ({
  getOrganizationIdForProject: vi.fn(async () => 'org-1'),
  getMailUsage: vi.fn(async () => ({
    tier: 'owner',
    limits: { domains: 69, pendingDomains: 3, addresses: 420, forwardsPerMonth: 80085 },
    used: { domains: 2, pendingDomains: 1, addresses: 5, forwardsThisMonth: null },
  })),
}))
const metrics = vi.hoisted(() => ({ recordSupportMetric: vi.fn(() => true) }))

const NOW_ROW = {
  id: 'sd-1',
  projectId: 'project-1',
  domain: 'acme.com',
  registrableDomain: 'acme.com',
  status: 'provisioning',
  provider: 'mailgun',
  providerAccountKey: 'acct',
  providerOwnership: null,
  providerState: null,
  receivesViaProvider: false,
  ownershipToken: 'tok',
  ownershipVerifiedAt: null,
  ownershipFailures: 0,
  providerFailures: 0,
  dnsRecords: [],
  verifiedAt: null,
  lastCheckedAt: null,
  nextCheckAt: null,
  leaseExpiresAt: null,
  attemptCount: 0,
  lastErrorCode: null,
  lastError: null,
  expiresAt: new Date('2026-10-29T00:00:00Z'),
  createdByUserId: 'user-1',
  createdAt: new Date('2026-10-22T00:00:00Z'),
  updatedAt: new Date('2026-10-22T00:00:00Z'),
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  setResponseStatus: (_event: unknown, code: number) => {
    state.responseStatus = code
  },
  setResponseHeader: (_event: unknown, name: string, value: string) => {
    state.responseHeaders[name] = value
  },
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => access)
vi.mock('~/server/utils/project-access', () => ({
  requireProjectAdmin: (...args: unknown[]) => (access.requireProjectAdmin as (...a: unknown[]) => unknown)(...args),
}))
vi.mock('~/server/utils/rate-limit', () => rateLimit)
vi.mock('~/server/utils/mail-limits', () => mailLimits)
vi.mock('~/server/utils/support-observability', () => metrics)
vi.mock('~/server/database/drizzle', () => {
  const chain = (): Record<string, unknown> => {
    const fluent: Record<string, unknown> = {
      set: (patch: Record<string, unknown>) => {
        state.updateSets.push(patch)
        return fluent
      },
      where: () => fluent,
      returning: () => Promise.resolve(state.markedRows),
    }
    return fluent
  }
  return { db: { update: () => chain() } }
})
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => provider) }))
vi.mock('~/server/utils/sending-domains', () => ({
  isSendingDomainsEnabled: () => state.enabled,
  resolveSenderPolicy: () => 'project',
  toSendingDomainView: (row: Record<string, unknown>, p: unknown) => ({
    id: row.id,
    domain: row.domain,
    status: row.status,
    lastErrorCode: row.lastErrorCode,
    providerMismatch: p ? row.providerAccountKey !== (p as { accountKey: string }).accountKey : false,
  }),
  ...claims,
}))
vi.mock('~/server/services/sending-domains/ownership', () => ({
  checkOwnershipTxt: vi.fn(async () => 'valid'),
  checkDmarc: vi.fn(async () => null),
  ownershipRecord: (domain: string, token: string) => ({
    purpose: 'ownership',
    type: 'TXT',
    name: `_veerify-mail.${domain}`,
    value: `veerify-mail-verification=${token}`,
    status: 'unknown',
  }),
}))
vi.mock('~/lib/support-sending-domains', async () => {
  const actual = await vi.importActual<typeof import('~/lib/support-sending-domains')>('~/lib/support-sending-domains')
  return {
    ...actual,
    // Stand-in for WP1's pure status transition.
    applyProviderResult: (row: { status: string }, result: { state: string }, ownership: string, now: Date) =>
      result.state === 'active' && ownership === 'valid'
        ? { status: 'verified', verifiedAt: now }
        : { status: row.status },
  }
})
vi.mock('~/server/utils/sending-domain-poller', async () => {
  const actual = await vi.importActual<typeof import('~/server/utils/sending-domain-poller')>(
    '~/server/utils/sending-domain-poller'
  )
  return { ...actual, ...poller }
})
vi.mock('~/server/utils/sending-domain-webhooks', () => webhooks)
vi.mock('~/server/utils/sending-domain-api', async () => {
  const actual = await vi.importActual<typeof import('~/server/utils/sending-domain-api')>(
    '~/server/utils/sending-domain-api'
  )
  return { ...actual, ...lease, listInboxesUsingDomain: vi.fn(async () => state.inboxes) }
})

const { SendingDomainProviderError } = await import('~/server/services/sending-domains/types')
const list = (await import('~/server/api/support/projects/[projectId]/sending-domains/index.get')).default
const create = (await import('~/server/api/support/projects/[projectId]/sending-domains/index.post')).default
const detail = (await import('~/server/api/support/projects/[projectId]/sending-domains/[id].get')).default
const verify = (await import('~/server/api/support/projects/[projectId]/sending-domains/[id]/verify.post')).default
const remove = (await import('~/server/api/support/projects/[projectId]/sending-domains/[id].delete')).default
const { filterInboxesUsingDomain } = await import('~/server/utils/sending-domain-api')

const event = {} as never
type Handler = (event: never) => Promise<{ success: boolean; data: any; message?: string }>
const call = (handler: unknown) => (handler as Handler)(event)

const activeResult = { domain: 'acme.com', state: 'active', receivesMail: false, records: [], message: null }
const forbidden = () => Promise.reject(Object.assign(new Error('forbidden'), { statusCode: 403 }))
const notFound = () => Promise.reject(Object.assign(new Error('not found'), { statusCode: 404 }))

beforeEach(() => {
  vi.clearAllMocks()
  state.params = { projectId: 'project-1', id: 'sd-1' }
  state.body = { domain: 'acme.com' }
  state.query = {}
  state.enabled = true
  state.isAdmin = true
  state.supportRole = 'admin'
  state.inboxes = []
  state.responseStatus = undefined
  state.responseHeaders = {}
  state.row = { ...NOW_ROW }
  state.rows = []
  state.markedRows = []
  state.updateSets = []
  lease.acquireSendingDomainLease.mockResolvedValue(true)
  provider.isConfigured.mockReturnValue({ configured: true, missing: [] })
  provider.register.mockResolvedValue({ ...activeResult, state: 'unverified', ownership: 'created' })
  provider.get.mockResolvedValue(activeResult)
  provider.verify.mockResolvedValue(activeResult)
  provider.remove.mockResolvedValue({ cleanup: null })
  claims.createSendingDomainClaim.mockImplementation(async () => ({ ...NOW_ROW }))
  claims.getProjectSendingDomain.mockImplementation(async () => ({ ...state.row }))
  claims.listProjectSendingDomains.mockImplementation(async () => state.rows)
  access.requireProjectAdmin.mockImplementation(async () => ({ id: 'tm-1', role: 'admin' }))
})

describe('GET sending-domains', () => {
  it('rejects a caller with no support role', async () => {
    state.supportRole = null
    await expect(call(list)).rejects.toMatchObject({ statusCode: 403 })
    expect(claims.listProjectSendingDomains).not.toHaveBeenCalled()
  })

  it('lets any support role read, and only admins manage', async () => {
    state.supportRole = 'agent'
    state.isAdmin = false
    state.rows = [{ ...NOW_ROW, status: 'pending' }]
    const res = await call(list)
    expect(res.data).toMatchObject({ enabled: true, canManage: false, provider: 'mailgun', policy: 'project' })
    expect(res.data.domains).toHaveLength(1)

    state.supportRole = 'admin'
    state.isAdmin = true
    expect((await call(list)).data.canManage).toBe(true)
    expect(claims.listProjectSendingDomains).toHaveBeenLastCalledWith('project-1')
  })

  it('fills maxDomains / maxPending from the workspace mail limits and adds the usage', async () => {
    const res = await call(list)
    expect(mailLimits.getOrganizationIdForProject).toHaveBeenCalledWith('project-1')
    expect(mailLimits.getMailUsage).toHaveBeenCalledWith('org-1')
    expect(res.data.limits).toEqual({ maxDomains: 69, maxPending: 3, pendingTtlDays: 7 })
    expect(res.data.usage).toMatchObject({ tier: 'owner', used: { domains: 2, pendingDomains: 1, addresses: 5 } })

    state.enabled = false
    expect((await call(list)).data).toMatchObject({
      enabled: false,
      limits: { maxDomains: 69 },
      usage: { tier: 'owner' },
    })
  })

  it('reports enabled:false without reading claims when the feature is off', async () => {
    state.enabled = false
    const res = await call(list)
    expect(res.data).toMatchObject({ enabled: false, domains: [], canManage: false })
    expect(claims.listProjectSendingDomains).not.toHaveBeenCalled()
  })

  it('names missing provider settings only', async () => {
    provider.isConfigured.mockReturnValue({ configured: false, missing: ['SUPPORT_MAILGUN_API_KEY'] })
    const res = await call(list)
    expect(res.data).toMatchObject({ providerConfigured: false, missingEnvVars: ['SUPPORT_MAILGUN_API_KEY'] })
  })
})

describe('GET sending-domains/[id]', () => {
  it('returns the claim with the inboxes using it', async () => {
    state.inboxes = [{ id: 'inbox-1', name: 'Support', emailAddress: 'support@acme.com' }]
    const res = await call(detail)
    expect(res.data).toMatchObject({ id: 'sd-1', inboxes: state.inboxes })
    expect(claims.getProjectSendingDomain).toHaveBeenCalledWith('project-1', 'sd-1')
  })

  it('surfaces the 404 for a claim of another project', async () => {
    claims.getProjectSendingDomain.mockImplementationOnce(notFound)
    await expect(call(detail)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('is 404 FEATURE_DISABLED when the feature is off', async () => {
    state.enabled = false
    await expect(call(detail)).rejects.toMatchObject({ statusCode: 404, data: { error: { code: 'FEATURE_DISABLED' } } })
  })
})

describe('POST sending-domains', () => {
  it('requires a project admin before anything else', async () => {
    access.requireProjectAdmin.mockImplementationOnce(forbidden)
    await expect(call(create)).rejects.toMatchObject({ statusCode: 403 })
    expect(access.requireProjectAdmin).toHaveBeenCalledWith('project-1', 'user-1')
    expect(rateLimit.requireRateLimit).not.toHaveBeenCalled()
    expect(claims.createSendingDomainClaim).not.toHaveBeenCalled()
  })

  it('is 404 FEATURE_DISABLED when the feature is off', async () => {
    state.enabled = false
    await expect(call(create)).rejects.toMatchObject({ statusCode: 404, data: { error: { code: 'FEATURE_DISABLED' } } })
    expect(claims.createSendingDomainClaim).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ domain: '' }], [{ domain: 5 }], [{ domain: 'a'.repeat(254) }]])(
    'rejects body %j with 400',
    async (body) => {
      state.body = body
      await expect(call(create)).rejects.toMatchObject({ statusCode: 400 })
      expect(claims.createSendingDomainClaim).not.toHaveBeenCalled()
    }
  )

  it('applies the per-project and per-user rate limits', async () => {
    await call(create)
    expect(rateLimit.requireRateLimit).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        identifier: 'sending-domain-create',
        subject: 'project:project-1',
        maxRequests: 10,
        windowSeconds: 3600,
      })
    )
    expect(rateLimit.requireRateLimit).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        identifier: 'sending-domain-create-user',
        subject: 'user:user-1',
        maxRequests: 5,
        windowSeconds: 60,
      })
    )
  })

  it('is 503 when the provider is not configured, without claiming anything', async () => {
    provider.isConfigured.mockReturnValue({ configured: false, missing: ['SUPPORT_MAILGUN_API_KEY'] })
    await expect(call(create)).rejects.toMatchObject({
      statusCode: 503,
      data: { error: { code: 'PROVIDER_NOT_CONFIGURED' } },
    })
    expect(claims.createSendingDomainClaim).not.toHaveBeenCalled()
  })

  it('claims with the current provider identity, registers and answers 201', async () => {
    const res = await call(create)
    expect(claims.createSendingDomainClaim).toHaveBeenCalledWith({
      projectId: 'project-1',
      domain: 'acme.com',
      userId: 'user-1',
      provider: 'mailgun',
      providerAccountKey: 'acct',
    })
    expect(provider.register).toHaveBeenCalledWith('acme.com')
    expect(state.responseStatus).toBe(201)
    expect(res.success).toBe(true)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending', providerOwnership: 'created' })
    )
    expect(poller.deleteSendingDomainRow).not.toHaveBeenCalled()
  })

  it('holds the row lease while registering so an admin delete cannot leak the provider domain', async () => {
    await call(create)
    const calls = poller.saveSendingDomainPatch.mock.calls as unknown as [unknown, Record<string, unknown>][]
    const first = calls[0]![1]
    expect(first.leaseExpiresAt).toBeInstanceOf(Date)
    expect((first.leaseExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
    // The outcome patch clears it again.
    expect(calls[calls.length - 1]![1]).toMatchObject({ leaseExpiresAt: null })
  })

  it('propagates claim-rule errors from the claim helper (e.g. DOMAIN_CLAIMED)', async () => {
    claims.createSendingDomainClaim.mockRejectedValueOnce(
      Object.assign(new Error('Conflict'), { statusCode: 409, data: { error: { code: 'DOMAIN_CLAIMED' } } })
    )
    await expect(call(create)).rejects.toMatchObject({ statusCode: 409, data: { error: { code: 'DOMAIN_CLAIMED' } } })
    expect(provider.register).not.toHaveBeenCalled()
  })

  it('keeps the row as failed and answers 202 on a transient provider error', async () => {
    provider.register.mockRejectedValueOnce(new SendingDomainProviderError('provider_unavailable', 'down', true))
    await call(create)
    expect(state.responseStatus).toBe(202)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed', lastErrorCode: 'provider_unavailable', attemptCount: 1 })
    )
    expect(poller.deleteSendingDomainRow).not.toHaveBeenCalled()
  })

  it('deletes the row and answers 409 DOMAIN_OWNED_ELSEWHERE', async () => {
    provider.register.mockRejectedValueOnce(new SendingDomainProviderError('owned_elsewhere', 'another project', false))
    await expect(call(create)).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'DOMAIN_OWNED_ELSEWHERE' } },
    })
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
  })

  it('deletes the row and answers 422 DOMAIN_REJECTED with the provider message', async () => {
    provider.register.mockRejectedValueOnce(
      new SendingDomainProviderError('invalid_domain', 'Invalid   domain name', false)
    )
    await expect(call(create)).rejects.toMatchObject({
      statusCode: 422,
      data: { error: { code: 'DOMAIN_REJECTED', message: 'Invalid domain name' } },
    })
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
  })

  it('deletes the row and answers 503 PROVIDER_MISCONFIGURED on a missing scope, and records the metric', async () => {
    provider.register.mockRejectedValueOnce(new SendingDomainProviderError('missing_scope', 'domains:manage', false))
    const failure = await call(create).catch((e) => e)
    expect(failure).toMatchObject({ statusCode: 503, data: { error: { code: 'PROVIDER_MISCONFIGURED' } } })
    // The operator-facing scope name must not reach the project admin.
    expect(JSON.stringify(failure.data)).not.toContain('domains:manage')
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
    expect(metrics.recordSupportMetric).toHaveBeenCalledWith('support.sending_domain.provider_misconfigured', {
      provider: 'mailgun',
    })
  })
})

describe('POST sending-domains/[id]/verify', () => {
  it('requires a project admin', async () => {
    access.requireProjectAdmin.mockImplementationOnce(forbidden)
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 403 })
    expect(claims.getProjectSendingDomain).not.toHaveBeenCalled()
  })

  it('is 404 for another project claim, before consuming any rate limit', async () => {
    claims.getProjectSendingDomain.mockImplementationOnce(notFound)
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 404 })
    expect(rateLimit.requireRateLimit).not.toHaveBeenCalled()
  })

  it('limits to one verify per 20 seconds per domain and 60 per hour per project', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    await call(verify)
    expect(rateLimit.requireRateLimit).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        identifier: 'sending-domain-verify',
        subject: 'domain:sd-1',
        maxRequests: 1,
        windowSeconds: 20,
      })
    )
    expect(rateLimit.requireRateLimit).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        identifier: 'sending-domain-verify-project',
        subject: 'project:project-1',
        maxRequests: 60,
        windowSeconds: 3600,
      })
    )
  })

  it('refuses a claim that is being removed', async () => {
    state.row = { ...NOW_ROW, status: 'deleting' }
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.verify).not.toHaveBeenCalled()
  })

  it('runs register again for a failed claim', async () => {
    state.row = { ...NOW_ROW, status: 'failed', attemptCount: 8 }
    await call(verify)
    expect(provider.register).toHaveBeenCalledTimes(1)
    expect(provider.verify).not.toHaveBeenCalled()
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending', attemptCount: 0 })
    )
  })

  it('keeps a created domain created when Register again finds it already at the provider', async () => {
    // An earlier attempt of ours (attemptCount > 0) may have created it before the answer was lost.
    state.row = { ...NOW_ROW, status: 'failed', attemptCount: 3, providerOwnership: null }
    provider.register.mockResolvedValueOnce({ ...activeResult, state: 'unverified', ownership: 'adopted' })
    await call(verify)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending', providerOwnership: 'created' })
    )
  })

  it('never relabels a created domain as adopted on Register again', async () => {
    state.row = { ...NOW_ROW, status: 'failed', attemptCount: 0, providerOwnership: 'created' }
    provider.register.mockResolvedValueOnce({ ...activeResult, state: 'unverified', ownership: 'adopted' })
    await call(verify)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ providerOwnership: 'created' })
    )
  })

  it('registers a suspended claim again when the provider domain is gone', async () => {
    state.row = {
      ...NOW_ROW,
      status: 'suspended',
      providerOwnership: 'created',
      verifiedAt: new Date(),
      expiresAt: null,
    }
    provider.verify.mockRejectedValueOnce(new SendingDomainProviderError('not_found', 'gone', false))
    provider.register.mockResolvedValueOnce({ ...activeResult, state: 'unverified', ownership: 'adopted' })
    await call(verify)
    expect(provider.register).toHaveBeenCalledTimes(1)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending', providerOwnership: 'created' })
    )
  })

  it('is 409 DOMAIN_BUSY while a register or poll pass holds the row, and does not touch the provider', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    lease.acquireSendingDomainLease.mockResolvedValueOnce(false)
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 409, data: { error: { code: 'DOMAIN_BUSY' } } })
    expect(provider.verify).not.toHaveBeenCalled()
    expect(provider.register).not.toHaveBeenCalled()
  })

  it('releases the lease even when the provider call fails', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    provider.verify.mockRejectedValueOnce(new SendingDomainProviderError('provider_unavailable', 'down', true))
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 503 })
    expect(lease.releaseSendingDomainLease).toHaveBeenCalledTimes(1)
  })

  it('runs register again when the claim belongs to a different provider project', async () => {
    state.row = { ...NOW_ROW, status: 'verified', providerAccountKey: 'old-project' }
    await call(verify)
    expect(provider.register).toHaveBeenCalledTimes(1)
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending', providerAccountKey: 'acct' })
    )
  })

  it('asks the provider to verify now for a pending claim and saves the result', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    const res = await call(verify)
    expect(provider.verify).toHaveBeenCalledWith('acme.com')
    expect(provider.get).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
    expect(poller.saveSendingDomainPatch).toHaveBeenCalledTimes(1)
  })

  it('ensures delivery webhooks once the claim is verified, but not while it is pending', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    await call(verify)
    expect(webhooks.syncDeliveryWebhooks).toHaveBeenCalledWith(expect.objectContaining({ id: 'sd-1' }), provider)

    webhooks.syncDeliveryWebhooks.mockClear()
    provider.verify.mockResolvedValueOnce({ ...activeResult, state: 'unverified' })
    await call(verify)
    expect(webhooks.syncDeliveryWebhooks).not.toHaveBeenCalled()
  })

  it('answers 429 with Retry-After when the provider rate limits', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    provider.verify.mockRejectedValueOnce(new SendingDomainProviderError('rate_limited', 'slow', true, 42))
    await expect(call(verify)).rejects.toMatchObject({ statusCode: 429 })
    expect(Number(state.responseHeaders['Retry-After'])).toBe(42)
  })

  it('answers 503 when the provider is unavailable', async () => {
    state.row = { ...NOW_ROW, status: 'pending' }
    provider.verify.mockRejectedValueOnce(new SendingDomainProviderError('provider_unavailable', 'down', true))
    await expect(call(verify)).rejects.toMatchObject({
      statusCode: 503,
      data: { error: { code: 'PROVIDER_UNAVAILABLE' } },
    })
  })

  it('answers 409 and keeps a visible failed claim when the provider says another project owns it', async () => {
    state.row = { ...NOW_ROW, status: 'failed' }
    provider.register.mockRejectedValueOnce(new SendingDomainProviderError('owned_elsewhere', 'taken', false))
    await expect(call(verify)).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'DOMAIN_OWNED_ELSEWHERE' } },
    })
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed', lastErrorCode: 'owned_elsewhere' })
    )
  })
})

describe('DELETE sending-domains/[id]', () => {
  beforeEach(() => {
    state.row = { ...NOW_ROW, status: 'verified', providerOwnership: 'created' }
    state.markedRows = [{ ...NOW_ROW, status: 'deleting', providerOwnership: 'created' }]
  })

  it('requires a project admin', async () => {
    access.requireProjectAdmin.mockImplementationOnce(forbidden)
    await expect(call(remove)).rejects.toMatchObject({ statusCode: 403 })
    expect(provider.remove).not.toHaveBeenCalled()
  })

  it('is 404 for another project claim', async () => {
    claims.getProjectSendingDomain.mockImplementationOnce(notFound)
    await expect(call(remove)).rejects.toMatchObject({ statusCode: 404 })
    expect(provider.remove).not.toHaveBeenCalled()
  })

  it('rejects an invalid force value with 400', async () => {
    state.query = { force: 'maybe' }
    await expect(call(remove)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('answers 409 DOMAIN_IN_USE with the inbox list unless forced', async () => {
    state.inboxes = [{ id: 'inbox-1', name: 'Support', emailAddress: 'support@acme.com' }]
    await expect(call(remove)).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'DOMAIN_IN_USE', details: { inboxes: state.inboxes } } },
    })
    expect(provider.remove).not.toHaveBeenCalled()
    expect(poller.deleteSendingDomainRow).not.toHaveBeenCalled()
  })

  it('deletes a domain Veerify created at the provider, then the row, when forced', async () => {
    state.inboxes = [{ id: 'inbox-1', name: 'Support', emailAddress: 'support@acme.com' }]
    state.query = { force: 'true' }
    const res = await call(remove)
    expect(res.data).toEqual({ deleted: true, operatorCleanupRequired: false })
    expect(provider.remove).toHaveBeenCalledWith('acme.com')
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
  })

  it('refuses with 409 DOMAIN_BUSY while a register holds the row lease (the provider domain would leak)', async () => {
    state.row = { ...NOW_ROW, status: 'provisioning', leaseExpiresAt: new Date(Date.now() + 60_000) }
    await expect(call(remove)).rejects.toMatchObject({ statusCode: 409, data: { error: { code: 'DOMAIN_BUSY' } } })
    expect(provider.remove).not.toHaveBeenCalled()
    expect(poller.deleteSendingDomainRow).not.toHaveBeenCalled()
    expect(state.updateSets).toEqual([])
  })

  it('allows the delete once the lease has lapsed', async () => {
    state.row = {
      ...NOW_ROW,
      status: 'verified',
      providerOwnership: 'created',
      leaseExpiresAt: new Date(Date.now() - 1000),
    }
    const res = await call(remove)
    expect(res.data).toMatchObject({ deleted: true })
  })

  it('answers 409 DOMAIN_BUSY when a register took the lease between the lookup and the mark', async () => {
    state.markedRows = []
    await expect(call(remove)).rejects.toMatchObject({ statusCode: 409, data: { error: { code: 'DOMAIN_BUSY' } } })
    expect(provider.remove).not.toHaveBeenCalled()
  })

  it('starts the removal retry budget when it marks the row deleting', async () => {
    await call(remove)
    expect(state.updateSets[0]).toMatchObject({ status: 'deleting', attemptCount: 0 })
  })

  it('releases the row with an operator cleanup request on a permanent provider refusal', async () => {
    provider.remove.mockRejectedValueOnce(new SendingDomainProviderError('owned_elsewhere', 'not yours', false))
    const res = await call(remove)
    expect(res.data).toEqual({ deleted: true, operatorCleanupRequired: true })
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
    expect(metrics.recordSupportMetric).toHaveBeenCalledWith(
      'support.sending_domain.operator_cleanup_required',
      expect.objectContaining({ domainId: 'sd-1' })
    )
  })

  it('never deletes an adopted provider domain', async () => {
    state.markedRows = [{ ...NOW_ROW, status: 'deleting', providerOwnership: 'adopted' }]
    await call(remove)
    expect(provider.remove).not.toHaveBeenCalled()
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
  })

  it('releases the row and tells the admin about operator cleanup when the domain receives mail', async () => {
    provider.remove.mockRejectedValueOnce(new SendingDomainProviderError('receiving_enabled', 'receives mail', false))
    const res = await call(remove)
    expect(res.data).toEqual({ deleted: true, operatorCleanupRequired: true })
    expect(res.message).toContain('operator must remove it')
    expect(poller.deleteSendingDomainRow).toHaveBeenCalledTimes(1)
    expect(metrics.recordSupportMetric).toHaveBeenCalledWith(
      'support.sending_domain.operator_cleanup_required',
      expect.objectContaining({ domainId: 'sd-1' })
    )
  })

  it('keeps the row in deleting and answers 202 on a transient provider error', async () => {
    provider.remove.mockRejectedValueOnce(new SendingDomainProviderError('provider_unavailable', 'down', true))
    const res = await call(remove)
    expect(state.responseStatus).toBe(202)
    expect(res.data).toMatchObject({ deleted: false, status: 'deleting' })
    expect(poller.deleteSendingDomainRow).not.toHaveBeenCalled()
    expect(poller.saveSendingDomainPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'deleting', lastErrorCode: 'provider_unavailable' })
    )
  })
})

describe('filterInboxesUsingDomain', () => {
  const inbox = (emailAddress: string | null, id = emailAddress ?? 'none') => ({ id, name: id, emailAddress })

  it('matches the exact domain and, when allowed, label-bounded subdomains', () => {
    const inboxes = [inbox('a@acme.com'), inbox('b@help.acme.com'), inbox('c@badacme.com'), inbox(null)]
    expect(filterInboxesUsingDomain('acme.com', inboxes, [], true).map((i) => i.id)).toEqual([
      'a@acme.com',
      'b@help.acme.com',
    ])
    expect(filterInboxesUsingDomain('acme.com', inboxes, [], false).map((i) => i.id)).toEqual(['a@acme.com'])
  })

  it('skips subdomains covered by a more specific claim of the same project', () => {
    const inboxes = [inbox('b@help.acme.com'), inbox('c@other.acme.com')]
    expect(filterInboxesUsingDomain('acme.com', inboxes, ['help.acme.com'], true).map((i) => i.id)).toEqual([
      'c@other.acme.com',
    ])
  })
})
