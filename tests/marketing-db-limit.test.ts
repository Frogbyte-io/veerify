import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  values: undefined as unknown,
  conflict: undefined as { target: unknown[]; set: Record<string, unknown>; setWhere: unknown } | undefined,
  returned: [] as Array<{ units: number | string }>,
  calls: 0,
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => {
        state.calls++
        state.values = values
        return {
          onConflictDoUpdate: (config: never) => {
            state.conflict = config
            return { returning: () => Promise.resolve(state.returned) }
          },
        }
      },
    }),
  },
}))

const { consumeDbLimit, requireDbLimit, dayStamp } = await import('~/server/utils/marketing-db-limit')
const { currentPeriod } = await import('~/server/utils/marketing-usage')

beforeEach(() => {
  state.values = undefined
  state.conflict = undefined
  state.returned = []
  state.calls = 0
})

describe('dayStamp', () => {
  it('is the UTC date', () => {
    expect(dayStamp(new Date('2026-10-10T23:59:59Z'))).toBe('2026-10-10')
  })
})

describe('consumeDbLimit', () => {
  it('upserts one unit on (team, period, key) with a below-limit guard', async () => {
    state.returned = [{ units: 1 }]
    const result = await consumeDbLimit('t1', 'ratelimit:suggest:s1:2026-10-10', 3)
    expect(result).toEqual({ allowed: true, remaining: 2 })
    expect(state.values).toMatchObject({
      organizationId: 't1',
      metric: 'ratelimit:suggest:s1:2026-10-10',
      units: 1,
      period: currentPeriod(),
    })
    expect(state.conflict?.target).toHaveLength(3)
    expect(state.conflict?.setWhere).toBeDefined()
  })

  it('reports zero remaining on the last allowed unit', async () => {
    state.returned = [{ units: '3' }]
    expect(await consumeDbLimit('t1', 'k', 3)).toEqual({ allowed: true, remaining: 0 })
  })

  it('denies when the guarded upsert returns no row', async () => {
    state.returned = []
    expect(await consumeDbLimit('t1', 'k', 3)).toEqual({ allowed: false, remaining: 0 })
  })

  it('denies without touching the database for a non-positive limit', async () => {
    expect(await consumeDbLimit('t1', 'k', 0)).toEqual({ allowed: false, remaining: 0 })
    expect(state.calls).toBe(0)
  })
})

describe('requireDbLimit', () => {
  it('throws a 429 when the limit is reached', async () => {
    vi.stubGlobal('createError', (e: unknown) => Object.assign(new Error('err'), e))
    state.returned = []
    await expect(requireDbLimit('t1', 'k', 1, 'slow down')).rejects.toMatchObject({ statusCode: 429 })
    state.returned = [{ units: 1 }]
    await expect(requireDbLimit('t1', 'k', 1, 'slow down')).resolves.toEqual({ allowed: true, remaining: 0 })
    vi.unstubAllGlobals()
  })
})
