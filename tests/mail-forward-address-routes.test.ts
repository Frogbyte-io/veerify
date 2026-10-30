import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SendingDomainProviderError } from '~/server/services/sending-domains/types'

/**
 * Address API validation for E3 forwarding (`deliverToInbox`, `forwardTo`).
 * The database is a queue of rows; the provider is a stub. Postgres-backed
 * coverage lives in tests/integration/mail-forward-e3.test.ts.
 */

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { id: 'inbox-1', addressId: 'address-1' } as Record<string, string>,
  queuedRows: [] as unknown[][],
  deleted: 0,
}))
const provider = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const routes = vi.hoisted(() => ({
  createDirectRouteForAddress: vi.fn(async (): Promise<'active' | 'failed' | null> => 'active'),
  syncAddressRoute: vi.fn(async () => ({ status: 'active' as const, routeId: 'r1', errorCode: null })),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getRouterParam: (_event: unknown, name: string) => state.params[name],
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({
  requireInboxRole: vi.fn(async () => ({ id: 'inbox-1', projectId: 'project-1' })),
}))
vi.mock('~/server/utils/sending-domains', () => ({
  isSendingDomainsEnabled: vi.fn(() => true),
  assertReceivingAddressAllowed: vi.fn(async () => undefined),
}))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))
vi.mock('~/server/utils/mail-limits', () => ({
  getOrganizationIdForProject: vi.fn(async () => 'org-1'),
  lockMailUsage: vi.fn(async () => undefined),
  assertCanAddMailAddress: vi.fn(async () => undefined),
}))
vi.mock('~/server/utils/inbox-address-rules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/inbox-address-rules')>()),
  lockInboxesForAddressChange: vi.fn(async () => undefined),
  resolveAddressDomainId: vi.fn(async () => 'domain-1'),
}))
vi.mock('~/server/utils/inbound-routes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/inbound-routes')>()),
  createDirectRouteForAddress: routes.createDirectRouteForAddress,
  syncAddressRoute: routes.syncAddressRoute,
}))
vi.mock('~/server/database/drizzle', () => {
  const chain = (kind: string): Record<string, unknown> => {
    if (kind === 'delete') state.deleted++
    const result = Promise.resolve(state.queuedRows.shift() ?? [])
    const fluent: Record<string, unknown> = {
      from: () => fluent,
      innerJoin: () => fluent,
      where: () => fluent,
      set: () => fluent,
      values: () => fluent,
      orderBy: () => fluent,
      limit: () => result,
      returning: () => result,
      then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    }
    return fluent
  }
  const db = {
    select: () => chain('select'),
    insert: () => chain('insert'),
    update: () => chain('update'),
    delete: () => chain('delete'),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }
  return { db }
})

const addressCreate = (await import('~/server/api/support/inboxes/[id]/addresses/index.post')).default
const addressPatch = (await import('~/server/api/support/inboxes/[id]/addresses/[addressId].patch')).default

const event = {} as never
const created = {
  id: 'address-1',
  inboxId: 'inbox-1',
  projectId: 'project-1',
  address: 'hello@acme.com',
  kind: 'custom',
  deliverToInbox: true,
  providerRouteStatus: null,
}
const claim = (extra: Record<string, unknown> = {}) => ({
  id: 'domain-1',
  receivingStatus: 'active',
  provider: 'frogmail',
  accountKey: 'acct',
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.body = { address: 'hello@acme.com' }
  state.params = { id: 'inbox-1', addressId: 'address-1' }
  state.queuedRows = []
  state.deleted = 0
  provider.current = { name: 'frogmail', accountKey: 'acct', capabilities: { forwarding: true } }
  routes.createDirectRouteForAddress.mockResolvedValue('active')
})

describe('POST addresses with forwards', () => {
  it('refuses a malformed forward address and more than five', async () => {
    state.body = { address: 'hello@acme.com', forwardTo: ['not-an-email'] }
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })

    state.body = { address: 'hello@acme.com', forwardTo: Array.from({ length: 6 }, (_, i) => `u${i}@example.org`) }
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(routes.createDirectRouteForAddress).not.toHaveBeenCalled()
  })

  it('needs at least one of inbox delivery or a forward', async () => {
    state.body = { address: 'hello@acme.com', deliverToInbox: false }
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })
    state.body = { address: 'hello@acme.com', deliverToInbox: false, forwardTo: [] }
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses forwards when the provider cannot forward', async () => {
    provider.current = { name: 'mailgun', accountKey: 'acct', capabilities: { forwarding: false } }
    state.body = { address: 'hello@acme.com', forwardTo: ['me@example.org'] }
    await expect(addressCreate(event)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'FORWARDING_UNAVAILABLE' },
    })
  })

  it('refuses forwards without a verified claim, or before receiving is enabled', async () => {
    state.body = { address: 'hello@acme.com', forwardTo: ['me@example.org'] }
    state.queuedRows = [[]]
    await expect(addressCreate(event)).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'FORWARD_DOMAIN_UNVERIFIED' },
    })
    state.queuedRows = [[claim({ receivingStatus: null })]]
    await expect(addressCreate(event)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'FORWARD_RECEIVING_UNAVAILABLE' },
    })
    expect(state.deleted).toBe(0)
  })

  it('refuses a forward to the address’s own domain (loop)', async () => {
    state.body = { address: 'hello@acme.com', forwardTo: ['boss@acme.com'] }
    state.queuedRows = [[claim()]]
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(routes.createDirectRouteForAddress).not.toHaveBeenCalled()
  })

  it('lowercases and deduplicates, and builds the route strictly with the overrides', async () => {
    state.body = {
      address: 'hello@acme.com',
      deliverToInbox: false,
      forwardTo: ['Me@Example.org', 'me@example.org', ' you@example.org '],
    }
    // claim lookup, insert returning, forwards listing
    state.queuedRows = [[claim()], [created], [], []]
    const response = (await addressCreate(event)) as { data: { address: Record<string, unknown> } }
    expect(routes.createDirectRouteForAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        deliverToInbox: false,
        forwardTo: ['me@example.org', 'you@example.org'],
        strict: true,
      })
    )
    expect(response.data.address).toMatchObject({ address: 'hello@acme.com', forwards: [] })
  })

  it('removes the address again and maps a provider refusal', async () => {
    state.body = { address: 'hello@acme.com', forwardTo: ['me@example.org'] }
    state.queuedRows = [[claim()], [created]]
    routes.createDirectRouteForAddress.mockRejectedValueOnce(
      new SendingDomainProviderError('forward_would_loop', 'loop', false)
    )
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.deleted).toBe(1)
  })

  it('removes the address when the route could not be created at all', async () => {
    state.body = { address: 'hello@acme.com', forwardTo: ['me@example.org'] }
    state.queuedRows = [[claim()], [created]]
    routes.createDirectRouteForAddress.mockResolvedValueOnce('failed')
    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 503 })
    expect(state.deleted).toBe(1)
  })

  it('keeps a plain address on the E2 path: no forwards, route failures never fail the request', async () => {
    state.queuedRows = [[created], []]
    routes.createDirectRouteForAddress.mockResolvedValueOnce('failed')
    const response = (await addressCreate(event)) as { data: { address: Record<string, unknown> } }
    expect(routes.createDirectRouteForAddress).toHaveBeenCalledWith(expect.objectContaining({ strict: false }))
    expect(response.data.address).toMatchObject({ providerRouteStatus: 'failed', forwards: [] })
  })
})

describe('PATCH address delivery', () => {
  it('refuses to drop inbox delivery with no forward', async () => {
    state.body = { deliverToInbox: false }
    state.queuedRows = [[created], []]
    await expect(addressPatch(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(routes.syncAddressRoute).not.toHaveBeenCalled()
  })

  it('refuses a loop forward and platform addresses', async () => {
    state.body = { forwardTo: ['x@acme.com'] }
    state.queuedRows = [[created], [claim()]]
    await expect(addressPatch(event)).rejects.toMatchObject({ statusCode: 400 })

    state.body = { forwardTo: ['x@example.org'] }
    state.queuedRows = [[{ ...created, kind: 'platform' }]]
    await expect(addressPatch(event)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('syncs the route first with the replacement forwards, and maps provider refusals', async () => {
    state.body = { forwardTo: ['Me@Example.org'] }
    state.queuedRows = [[created], [claim()], [created], []]
    await addressPatch(event)
    expect(routes.syncAddressRoute).toHaveBeenCalledWith('address-1', {
      deliverToInbox: undefined,
      forwardTo: ['me@example.org'],
      strict: true,
    })

    state.queuedRows = [[created], [claim()]]
    routes.syncAddressRoute.mockRejectedValueOnce(new SendingDomainProviderError('forward_requires_ses', 'x', false))
    await expect(addressPatch(event)).rejects.toMatchObject({ statusCode: 409 })
  })
})
