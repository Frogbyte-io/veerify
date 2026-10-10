import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  insertValues: undefined as unknown,
  conflict: undefined as unknown,
  rows: [] as unknown[],
  insertCalls: 0,
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => {
        state.insertCalls++
        state.insertValues = values
        return {
          onConflictDoUpdate: (config: unknown) => {
            state.conflict = config
            return Promise.resolve()
          },
        }
      },
    }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.rows) }),
    }),
  },
}))

const { currentPeriod, recordUsage, getUsage } = await import('~/server/utils/marketing-usage')

beforeEach(() => {
  state.insertValues = undefined
  state.conflict = undefined
  state.rows = []
  state.insertCalls = 0
})

describe('currentPeriod', () => {
  it('formats UTC year and zero-padded month', () => {
    expect(currentPeriod(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03')
    expect(currentPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('uses UTC at month boundaries', () => {
    expect(currentPeriod(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10')
    expect(currentPeriod(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09')
  })
})

describe('recordUsage', () => {
  it('upserts an increment on (team, period, metric)', async () => {
    await recordUsage('team-1', 'crawl:pages', 7)

    expect(state.insertValues).toMatchObject({
      teamId: 'team-1',
      metric: 'crawl:pages',
      units: 7,
      period: currentPeriod(),
    })
    const conflict = state.conflict as { target: unknown[]; set: Record<string, unknown> }
    expect(conflict.target).toHaveLength(3)
    expect(conflict.set).toHaveProperty('units')
  })

  it('ignores zero, negative and non-finite amounts', async () => {
    await recordUsage('team-1', 'crawl:pages', 0)
    await recordUsage('team-1', 'crawl:pages', -5)
    await recordUsage('team-1', 'crawl:pages', Number.NaN)
    expect(state.insertCalls).toBe(0)
  })
})

describe('getUsage', () => {
  it('returns a metric to units map with numeric values', async () => {
    state.rows = [
      { metric: 'crawl:pages', units: 12 },
      { metric: 'llm:anthropic:input_tokens', units: '3400' },
    ]
    await expect(getUsage('team-1', '2026-10')).resolves.toEqual({
      'crawl:pages': 12,
      'llm:anthropic:input_tokens': 3400,
    })
  })

  it('returns an empty record when nothing was used', async () => {
    await expect(getUsage('team-1')).resolves.toEqual({})
  })
})
