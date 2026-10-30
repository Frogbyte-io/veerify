import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  denied: null as null | { statusCode: number },
}))

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('getRouterParam', () => 'brand')

vi.mock('~/server/utils/project-categories', () => ({
  requireProjectBySlug: vi.fn(async () => {
    if (state.denied) throw Object.assign(new Error('denied'), state.denied)
    return { project: { id: 'proj-1' }, organizationId: 'org-1', role: 'member' }
  }),
}))
vi.mock('~/server/utils/mail-limits', () => ({
  getMailUsage: vi.fn(async () => ({ tier: 'standard', limits: {}, used: { addresses: state.rows.length } })),
}))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
}))
vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin']) chain[m] = () => chain
  chain.where = () => Promise.resolve(state.rows)
  return { db: chain }
})

const { default: handler } = await import('~/server/api/projects/[slug]/mail/addresses.get')

const call = handler as unknown as (event: unknown) => Promise<any>

function row(address: string, extra: Record<string, unknown> = {}) {
  return {
    id: address,
    address,
    kind: 'custom',
    isPrimary: false,
    behaviour: 'helpdesk',
    inboxId: 'inbox-1',
    inboxName: 'Support',
    productId: null,
    productName: null,
    domainId: 'dom-1',
    routeStatus: null,
    createdAt: new Date('2026-10-28T10:00:00Z'),
    ...extra,
  }
}

describe('GET /api/projects/[slug]/mail/addresses (E3 fields)', () => {
  it('returns deliverToInbox, empty forwards, domains and the forwarding capability', async () => {
    state.rows = [row('hello@b.com', { deliverToInbox: false })]
    const res = await call({})
    expect(res.data.addresses[0]).toMatchObject({ deliverToInbox: false, forwards: [] })
    expect(Array.isArray(res.data.domains)).toBe(true)
    expect(typeof res.data.forwarding).toBe('boolean')
  })
})

describe('GET /api/projects/[slug]/mail/addresses', () => {
  beforeEach(() => {
    state.rows = []
    state.denied = null
  })

  it('sorts by domain, catch-all last, then address, and maps fields', async () => {
    state.rows = [
      row('*@b.com'),
      row('sales@b.com'),
      row('hello@b.com', { productId: 'p1', productName: 'Decker', routeStatus: 'active', behaviour: 'mail' }),
      row('zed@a.com', { kind: 'platform', routeStatus: 'bogus' }),
    ]
    const res = await call({})
    expect(res.success).toBe(true)
    expect(res.data.addresses.map((a: { address: string }) => a.address)).toEqual([
      'zed@a.com',
      'hello@b.com',
      'sales@b.com',
      '*@b.com',
    ])
    const [platform, hello, , catchAll] = res.data.addresses
    expect(platform).toMatchObject({ kind: 'platform', routeStatus: null, isCatchAll: false })
    expect(hello).toMatchObject({ behaviour: 'mail', productName: 'Decker', routeStatus: 'active' })
    expect(catchAll.isCatchAll).toBe(true)
    expect(hello.createdAt).toBe('2026-10-28T10:00:00.000Z')
    expect(res.data.usage.tier).toBe('standard')
  })

  it('returns an empty list for a project without addresses', async () => {
    const res = await call({})
    expect(res.data.addresses).toEqual([])
  })

  it('propagates access errors', async () => {
    state.denied = { statusCode: 403 }
    await expect(call({})).rejects.toMatchObject({ statusCode: 403 })
  })
})
