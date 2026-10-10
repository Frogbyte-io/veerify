import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  adminError: null as null | number,
  term: { id: 'term-1', siteId: 'site-1', kind: 'competitor', competitorDomain: 'rival.com' } as unknown,
  counts: { site: 0, term: 0 },
  inserted: [] as unknown[],
  insertReturns: true,
  termWhere: undefined as unknown,
  updateWhere: undefined as unknown,
  updateReturns: true,
  body: {} as unknown,
  selects: 0,
}))

const httpError = (statusCode: number) => Object.assign(new Error(String(statusCode)), { statusCode })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage?: string }) =>
  Object.assign(new Error(input.statusMessage ?? ''), input)
)
vi.stubGlobal('readBody', async () => state.body)

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))
vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAdmin: vi.fn(async () => {
    if (state.adminError) throw httpError(state.adminError)
    return { project: { id: 'p1' }, teamId: 't1' }
  }),
  requireMarketingAccess: vi.fn(async () => ({ project: { id: 'p1' }, teamId: 't1' })),
}))
vi.mock('~/server/utils/marketing-site', () => ({
  requireRouteParam: (_e: unknown, name: string) => (name === 'projectId' ? 'p1' : 'w1'),
  findMarketingSite: vi.fn(async () => ({ id: 'site-1', origin: 'https://example.com' })),
}))
vi.mock('~/server/utils/marketing-terms', () => ({
  requireMarketingSite: vi.fn(async () => ({ id: 'site-1', origin: 'https://example.com' })),
}))
vi.mock('~/server/utils/validation', async () => {
  const { z } = await import('zod')
  return {
    validateBody: async (_e: unknown, schema: InstanceType<typeof z.ZodType>) => {
      const result = schema.safeParse(state.body)
      if (!result.success) throw httpError(400)
      return result.data
    },
  }
})
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ error: { code, message } }),
  ErrorCode: { NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT', VALIDATION_ERROR: 'VALIDATION_ERROR' },
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const n = state.selects++
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = (cond: unknown) => {
        if (n === 0) state.termWhere = cond
        return chain
      }
      chain.limit = () => Promise.resolve(state.term ? [state.term] : [])
      // the counts query is awaited right after where()
      chain.then = (resolve: (v: unknown) => void) => resolve([state.counts])
      return chain
    }),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        state.inserted.push(v)
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(state.insertReturns ? [{ ...(v as object) }] : []),
          }),
        }
      },
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: (cond: unknown) => {
          state.updateWhere = cond
          return {
            returning: () => Promise.resolve(state.updateReturns ? [{ id: 'w1', termId: 'term-1' }] : []),
          }
        },
      }),
    })),
  },
}))

const post = (await import('~/server/api/marketing/projects/[projectId]/competitors/watches/index.post')).default as (
  e: unknown
) => Promise<{ data: { watch: { url: string } } }>
const patch = (await import('~/server/api/marketing/projects/[projectId]/competitors/watches/[watchId].patch'))
  .default as (e: unknown) => Promise<unknown>
const { validateWatchUrl } = await import('~/server/utils/marketing-competitors')

beforeEach(() => {
  state.adminError = null
  state.term = { id: 'term-1', siteId: 'site-1', kind: 'competitor', competitorDomain: 'rival.com' }
  state.counts = { site: 0, term: 0 }
  state.inserted = []
  state.insertReturns = true
  state.updateReturns = true
  state.selects = 0
  state.body = { termId: 'term-1', url: 'https://rival.com/pricing', kind: 'pricing' }
})

describe('validateWatchUrl', () => {
  const own = 'https://www.example.com'
  it('accepts https pages on the competitor domain and its subdomains', () => {
    expect(validateWatchUrl('https://rival.com/pricing#x', own, 'rival.com')).toBe('https://rival.com/pricing')
    expect(validateWatchUrl('https://docs.rival.com/changelog', own, 'rival.com')).toBe(
      'https://docs.rival.com/changelog'
    )
    expect(validateWatchUrl('https://www.rival.com/', own, 'rival.com')).toBe('https://www.rival.com/')
  })
  it('accepts any public host when the competitor has no domain', () => {
    expect(validateWatchUrl('https://anything.io/p', own, null)).toBe('https://anything.io/p')
  })
  it('rejects http, credentials, ports and IPs', () => {
    for (const url of [
      'http://rival.com/',
      'https://u:p@rival.com/',
      'https://rival.com:8443/',
      'https://127.0.0.1/',
      'https://localhost/',
    ]) {
      expect(() => validateWatchUrl(url, own, null)).toThrow()
    }
  })
  it('rejects the product own host, with or without www', () => {
    expect(() => validateWatchUrl('https://example.com/pricing', own, null)).toThrow()
    expect(() => validateWatchUrl('https://www.example.com/pricing', own, null)).toThrow()
  })
  it('rejects hosts outside the competitor domain, including look-alikes', () => {
    expect(() => validateWatchUrl('https://other.com/', own, 'rival.com')).toThrow()
    expect(() => validateWatchUrl('https://notrival.com/', own, 'rival.com')).toThrow()
    expect(() => validateWatchUrl('https://rival.com.evil.io/', own, 'rival.com')).toThrow()
  })
})

describe('POST watches', () => {
  it('creates a watch', async () => {
    const result = await post({})
    expect(result.data.watch.url).toBe('https://rival.com/pricing')
    expect(state.inserted).toHaveLength(1)
  })

  it('is admin only', async () => {
    state.adminError = 403
    await expect(post({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserted).toHaveLength(0)
  })

  it('scopes the competitor lookup to the site, so another product term reads as 404', async () => {
    state.term = null
    await expect(post({})).rejects.toMatchObject({ statusCode: 404 })
    const { sql, params } = new PgDialect().sqlToQuery(state.termWhere as never)
    expect(sql).toContain('"marketing_term"."site_id"')
    expect(sql).toContain('"marketing_term"."kind"')
    expect(params).toContain('site-1')
    expect(params).toContain('competitor')
  })

  it('rejects the product own host and hosts outside the competitor domain', async () => {
    state.body = { termId: 'term-1', url: 'https://example.com/pricing', kind: 'pricing' }
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 })
    state.selects = 0
    state.body = { termId: 'term-1', url: 'https://other.com/pricing', kind: 'pricing' }
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toHaveLength(0)
  })

  it('enforces 3 per competitor and 15 per site', async () => {
    state.counts = { site: 3, term: 3 }
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 })
    state.selects = 0
    state.counts = { site: 15, term: 1 }
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toHaveLength(0)
  })

  it('validates the body', async () => {
    state.body = { termId: 'term-1', url: 'https://rival.com/', kind: 'nope' }
    await expect(post({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('reports a duplicate page as 409', async () => {
    state.insertReturns = false
    await expect(post({})).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('PATCH watch', () => {
  it('is admin only', async () => {
    state.adminError = 403
    state.body = { status: 'paused' }
    await expect(patch({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('scopes the update to the site so another product watch reads as 404', async () => {
    state.body = { status: 'paused' }
    state.updateReturns = false
    await expect(patch({})).rejects.toMatchObject({ statusCode: 404 })
    const { sql, params } = new PgDialect().sqlToQuery(state.updateWhere as never)
    expect(sql).toContain('"competitor_watch"."site_id"')
    expect(params).toContain('site-1')
  })

  it('only accepts active or paused', async () => {
    state.body = { status: 'error' }
    await expect(patch({})).rejects.toMatchObject({ statusCode: 400 })
  })
})
