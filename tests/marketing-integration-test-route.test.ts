import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  adminTeams: ['team-a'] as string[],
  memoryLimited: false,
  dbLimited: false,
  dbLimitCalls: [] as Array<unknown[]>,
  rateConfigs: [] as Array<Record<string, unknown>>,
  ran: [] as Array<[string, string]>,
  usage: [] as Array<unknown[]>,
}))

const httpError = (statusCode: number) => Object.assign(new Error(String(statusCode)), { statusCode })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage?: string }) =>
  Object.assign(new Error(input.statusMessage ?? ''), input)
)

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))
vi.mock('~/server/utils/marketing-site', () => ({
  requireRouteParam: (event: { params: Record<string, string> }, name: string) => event.params[name],
}))
vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async (teamId: string) => {
    if (!state.adminTeams.includes(teamId)) throw httpError(403)
    return { role: 'admin' }
  }),
  requireTeamMembership: vi.fn(),
}))
vi.mock('~/server/utils/rate-limit', () => ({
  requireRateLimit: vi.fn(async (_e: unknown, config: Record<string, unknown>) => {
    state.rateConfigs.push(config)
    if (state.memoryLimited) throw httpError(429)
  }),
}))
vi.mock('~/server/utils/marketing-db-limit', () => ({
  dayStamp: () => '2026-10-11',
  requireDbLimit: vi.fn(async (...args: unknown[]) => {
    state.dbLimitCalls.push(args)
    if (state.dbLimited) throw httpError(429)
  }),
}))
vi.mock('~/server/utils/marketing-usage', () => ({
  recordUsage: vi.fn(async (...args: unknown[]) => void state.usage.push(args)),
}))
vi.mock('~/server/services/marketing/integration-test', () => ({
  isIntegrationId: (id: string) => ['anthropic', 'secrets'].includes(id),
  runIntegrationTest: vi.fn(async (teamId: string, id: string) => {
    state.ran.push([teamId, id])
    return { id, ok: true, durationMs: 5, detail: 'fine', source: 'team' }
  }),
}))

const handler = (await import('~/server/api/marketing/teams/[teamId]/integrations/[id]/test.post'))
  .default as unknown as (e: unknown) => Promise<{ data: Record<string, unknown> }>

const call = (teamId = 'team-a', id = 'anthropic') => handler({ params: { teamId, id } })

beforeEach(() => {
  state.adminTeams = ['team-a']
  state.memoryLimited = false
  state.dbLimited = false
  state.dbLimitCalls = []
  state.rateConfigs = []
  state.ran = []
  state.usage = []
})

describe('POST integration test', () => {
  it('runs the test, returns the result and records usage', async () => {
    const result = await call()
    expect(result.data).toEqual({ id: 'anthropic', ok: true, durationMs: 5, detail: 'fine', source: 'team' })
    expect(state.usage).toEqual([['team-a', 'integrations:tests', 1]])
  })

  it('refuses non-admins and other teams before running anything', async () => {
    await expect(call('team-b')).rejects.toMatchObject({ statusCode: 403 })
    expect(state.ran).toEqual([])
    expect(state.usage).toEqual([])
  })

  it('rejects unknown integrations', async () => {
    await expect(call('team-a', 'nope')).rejects.toMatchObject({ statusCode: 400 })
    expect(state.ran).toEqual([])
  })

  it('limits 10 per hour per team in memory and in the database', async () => {
    await call()
    expect(state.rateConfigs[0]).toMatchObject({ maxRequests: 10, windowSeconds: 3600, subject: 'team-a' })
    expect(state.dbLimitCalls[0].slice(0, 3)).toEqual([
      'team-a',
      expect.stringMatching(/^ratelimit:integration-test:2026-10-11T\d+$/),
      10,
    ])
  })

  it('answers 429 from either limiter without running the check', async () => {
    state.memoryLimited = true
    await expect(call()).rejects.toMatchObject({ statusCode: 429 })
    state.memoryLimited = false
    state.dbLimited = true
    await expect(call()).rejects.toMatchObject({ statusCode: 429 })
    expect(state.ran).toEqual([])
    expect(state.usage).toEqual([])
  })
})
