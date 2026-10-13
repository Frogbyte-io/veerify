import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  body: {} as unknown,
  headers: {} as Record<string, string>,
  admin: true,
  rateLimitKeys: [] as string[],
  tokenRequest: null as { id: string } | null,
  slug: 'acme',
  erase: [] as unknown[][],
  withdraw: [] as string[],
  deleted: [] as string[],
  exported: [] as unknown[][],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('setHeader', (_e: unknown, name: string, value: string) => void (state.headers[name] = value))
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async () => {
    if (!state.admin) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { role: 'admin' }
  }),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingDataAdmin: vi.fn(async () => {
    if (!state.admin) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { project: { id: 'p1', slug: state.slug, teamId: 't1' }, teamId: 't1' }
  }),
}))

vi.mock('~/server/utils/rate-limit', () => ({
  rateLimits: { strict: { maxRequests: 5, windowSeconds: 60 }, relaxed: { maxRequests: 100, windowSeconds: 60 } },
  requireRateLimit: vi.fn(async (_e: unknown, config: { identifier?: string }) => {
    state.rateLimitKeys.push(config.identifier ?? '')
  }),
}))

vi.mock('~/server/utils/marketing-reviews', () => ({
  findReviewRequestByToken: vi.fn(async () => state.tokenRequest),
  notFound: (message: string) => {
    throw Object.assign(new Error(message), { statusCode: 404 })
  },
}))

vi.mock('~/server/services/marketing/privacy', () => ({
  eraseContact: vi.fn(async (teamId: string, email: string) => {
    state.erase.push([teamId, email])
    return { reviewRequestsDeleted: 1, testimonialsDeleted: 2, suppressed: true }
  }),
  withdrawTestimonialConsent: vi.fn(async (id: string) => {
    state.withdraw.push(id)
    return 1
  }),
  deleteProductMarketingData: vi.fn(async (id: string) => {
    state.deleted.push(id)
    return { siteDeleted: true }
  }),
}))

vi.mock('~/server/services/marketing/data-export', () => ({
  exportProductMarketingData: vi.fn(async (id: string, slug: string) => {
    state.exported.push([id, slug])
    return { product: { id, slug } }
  }),
}))

const erase = (await import('~/server/api/marketing/teams/[teamId]/erase-contact.post')).default as any
const withdraw = (await import('~/server/api/marketing/r/[token]/withdraw.post')).default as any
const exportRoute = (await import('~/server/api/marketing/projects/[projectId]/export.get')).default as any
const deleteRoute = (await import('~/server/api/marketing/projects/[projectId]/data.delete')).default as any

const TOKEN = 'a'.repeat(43)

beforeEach(() => {
  state.params = {}
  state.body = {}
  state.headers = {}
  state.admin = true
  state.rateLimitKeys = []
  state.tokenRequest = { id: 'rr1' }
  state.erase = []
  state.withdraw = []
  state.deleted = []
  state.exported = []
})

describe('POST erase-contact', () => {
  it('erases for the route team and returns counts', async () => {
    state.params = { teamId: 'team-1' }
    state.body = { email: ' Jane@Example.com ' }
    const result = await erase({})
    expect(state.erase).toEqual([['team-1', 'Jane@Example.com']])
    expect(result.data).toEqual({ reviewRequestsDeleted: 1, testimonialsDeleted: 2, suppressed: true })
  })

  it('needs a team admin', async () => {
    state.admin = false
    state.params = { teamId: 'team-1' }
    state.body = { email: 'jane@example.com' }
    await expect(erase({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.erase).toEqual([])
  })

  it('rejects an invalid email', async () => {
    state.params = { teamId: 'team-1' }
    state.body = { email: 'not-an-email' }
    await expect(erase({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.erase).toEqual([])
  })
})

describe('POST r/[token]/withdraw', () => {
  it('withdraws consent for the token request and is rate limited per token', async () => {
    state.params = { token: TOKEN }
    const result = await withdraw({})
    expect(state.withdraw).toEqual(['rr1'])
    expect(result.data).toEqual({ withdrawn: 1 })
    expect(state.rateLimitKeys).toEqual([`public-testimonial-withdraw:${TOKEN}`])
  })

  it('still withdraws through the retained token once the request was anonymised', async () => {
    state.params = { token: TOKEN }
    state.tokenRequest = { id: 'rr1', email: 'redacted:rr1', emailHash: 'h' } as never
    expect((await withdraw({})).data).toEqual({ withdrawn: 1 })
    expect(state.withdraw).toEqual(['rr1'])
  })

  it('404s on an unknown token without changing anything', async () => {
    state.params = { token: TOKEN }
    state.tokenRequest = null
    await expect(withdraw({})).rejects.toMatchObject({ statusCode: 404 })
    expect(state.withdraw).toEqual([])
  })
})

describe('GET export', () => {
  it('returns a JSON attachment for admins', async () => {
    state.params = { projectId: 'p1' }
    const data = await exportRoute({})
    expect(data).toEqual({ product: { id: 'p1', slug: 'acme' } })
    expect(state.headers['content-disposition']).toBe('attachment; filename="marketing-acme.json"')
    expect(state.headers['cache-control']).toBe('no-store')
  })

  it('needs a team admin', async () => {
    state.admin = false
    state.params = { projectId: 'p1' }
    await expect(exportRoute({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.exported).toEqual([])
  })
})

describe('DELETE data', () => {
  it('requires the product slug as confirmation', async () => {
    state.params = { projectId: 'p1' }
    for (const confirm of ['', 'ACME', 'other', 'p1']) {
      state.body = { confirm }
      await expect(deleteRoute({})).rejects.toMatchObject({ statusCode: 400 })
    }
    state.body = {}
    await expect(deleteRoute({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.deleted).toEqual([])
  })

  it('deletes with the right slug', async () => {
    state.params = { projectId: 'p1' }
    state.body = { confirm: 'acme' }
    const result = await deleteRoute({})
    expect(state.deleted).toEqual(['p1'])
    expect(result.data).toEqual({ siteDeleted: true })
  })

  it('needs a team admin', async () => {
    state.admin = false
    state.params = { projectId: 'p1' }
    state.body = { confirm: 'acme' }
    await expect(deleteRoute({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.deleted).toEqual([])
  })
})
