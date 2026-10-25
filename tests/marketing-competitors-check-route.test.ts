import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  site: { id: 'site-1', verifiedAt: new Date() } as { id: string; verifiedAt: Date | null },
  watch: null as unknown,
  outcome: 'baseline' as string,
  rateLimit: [] as Array<Record<string, unknown>>,
  rateLimited: false,
  checked: 0,
}))

const httpError = (statusCode: number) => Object.assign(new Error(String(statusCode)), { statusCode })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage?: string }) =>
  Object.assign(new Error(input.statusMessage ?? ''), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })),
}))
vi.mock('~/server/utils/marketing-access', () => ({ requireMarketingAdmin: vi.fn(async () => ({})) }))
vi.mock('~/server/utils/marketing-site', () => ({ requireRouteParam: (_e: unknown, name: string) => name }))
vi.mock('~/server/utils/marketing-terms', () => ({ requireMarketingSite: vi.fn(async () => state.site) }))
vi.mock('~/server/services/marketing/competitors/store', () => ({
  loadWatchContext: vi.fn(async () => state.watch),
  dbCompetitorStore: {},
}))
vi.mock('~/server/services/marketing/competitors/checker', () => ({
  MANUAL_CHECK_MIN_INTERVAL_MS: 60 * 60 * 1000,
  checkWatchNow: vi.fn(async () => {
    state.checked++
    return state.outcome
  }),
}))
vi.mock('~/server/utils/rate-limit', () => ({
  requireRateLimit: vi.fn(async (_e: unknown, config: Record<string, unknown>) => {
    state.rateLimit.push(config)
    if (state.rateLimited) throw httpError(429)
  }),
}))

const handler = (await import('~/server/api/marketing/projects/[projectId]/competitors/watches/[watchId]/check.post'))
  .default as (e: unknown) => Promise<{ data: { outcome: string } }>

beforeEach(() => {
  state.site = { id: 'site-1', verifiedAt: new Date() }
  state.watch = { id: 'w1', url: 'https://Rival.com./pricing', lastCheckedAt: null }
  state.outcome = 'baseline'
  state.rateLimit = []
  state.rateLimited = false
  state.checked = 0
})

describe('POST watch check', () => {
  it('runs a check and keys the rate limit on site and host, not on the watch', async () => {
    const result = await handler({})
    expect(result.data.outcome).toBe('baseline')
    expect(state.rateLimit[0]).toMatchObject({ subject: 'site-1:rival.com', maxRequests: 3 })
  })

  it('shares the limit between a deleted and a re-created watch on the same host', async () => {
    await handler({})
    state.watch = { id: 'w2', url: 'https://rival.com/pricing', lastCheckedAt: null }
    await handler({})
    expect(state.rateLimit[0].subject).toBe(state.rateLimit[1].subject)
  })

  it('requires a verified site', async () => {
    state.site = { id: 'site-1', verifiedAt: null }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.checked).toBe(0)
  })

  it('refuses with 429 when the watch was checked within the last hour, before the rate limit or any fetch', async () => {
    state.watch = { id: 'w1', url: 'https://rival.com/p', lastCheckedAt: new Date(Date.now() - 10 * 60 * 1000) }
    await expect(handler({})).rejects.toMatchObject({ statusCode: 429 })
    expect(state.rateLimit).toHaveLength(0)
    expect(state.checked).toBe(0)
  })

  it('allows a check when the last one was over an hour ago', async () => {
    state.watch = { id: 'w1', url: 'https://rival.com/p', lastCheckedAt: new Date(Date.now() - 2 * 3600 * 1000) }
    await expect(handler({})).resolves.toBeDefined()
  })

  it('reports 429 when the claim is lost to the cron or another manual check', async () => {
    state.outcome = 'busy'
    await expect(handler({})).rejects.toMatchObject({ statusCode: 429 })
  })

  it('applies the daily limit', async () => {
    state.rateLimited = true
    await expect(handler({})).rejects.toMatchObject({ statusCode: 429 })
    expect(state.checked).toBe(0)
  })

  it('404s for an unknown watch', async () => {
    state.watch = null
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
  })
})
