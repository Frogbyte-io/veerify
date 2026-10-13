import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: new Map<string, { units: number; updatedAt: number }>(),
  statements: [] as { text: string; params: unknown[] }[],
  lock: Promise.resolve() as Promise<unknown>,
}))

const key = (team: unknown, period: unknown, metric: unknown) => `${team}|${period}|${metric}`

/**
 * Tiny in-memory stand-in for the statements llm-budget issues. Each statement is recognised by its
 * text and applied to a map, so the guard's WHERE (including the cost-row subselect) is exercised.
 * Transactions run one at a time, like row-lock serialisation on the reserved counter.
 */
function run(text: string, p: unknown[]): { rows: unknown[] } {
  state.statements.push({ text, params: p })
  const now = Date.now()
  if (text.includes('RETURNING units')) {
    const [amount, team, period, reserved, , , , spent, cap] = p as [
      number,
      string,
      string,
      string,
      number,
      string,
      string,
      string,
      number,
    ]
    const row = state.rows.get(key(team, period, reserved))
    const cost = state.rows.get(key(team, period, spent))?.units ?? 0
    if (!row || row.units + Number(amount) + cost > Number(cap)) return { rows: [] }
    row.units += Number(amount)
    row.updatedAt = now
    return { rows: [{ units: row.units }] }
  }
  if (text.endsWith('DO UPDATE SET units = marketing_usage.units')) {
    // lock-taking no-op upsert of the reserved row
    const k = key(p[0], p[1], p[2])
    if (!state.rows.has(k)) state.rows.set(k, { units: 0, updatedAt: now })
    return { rows: [] }
  }
  if (text.includes('GREATEST')) {
    const [held, team, period, metric] = p as [number, string, string, string]
    const row = state.rows.get(key(team, period, metric))
    if (row) {
      row.units = Math.max(row.units - Number(held), 0)
      row.updatedAt = now
    }
    return { rows: [] }
  }
  if (text.includes('VALUES')) {
    const [team, period, metric, actual] = p as [string, string, string, number]
    const k = key(team, period, metric)
    const row = state.rows.get(k)
    if (row) row.units += Number(actual)
    else state.rows.set(k, { units: Number(actual), updatedAt: now })
    return { rows: [] }
  }
  if (text.includes('LIKE')) {
    const cutoff = new Date(String(p[0])).getTime()
    const hit: unknown[] = []
    for (const [k, row] of state.rows) {
      if (/\|llm:[^|]+:reserved_usd_micros$/.test(k) && row.units > 0 && row.updatedAt < cutoff) {
        row.units = 0
        hit.push({ team_id: k.split('|')[0] })
      }
    }
    return { rows: hit }
  }
  throw new Error(`Unrecognised statement: ${text}`)
}

vi.mock('~/server/database/drizzle', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core')
  const dialect = new PgDialect()
  const exec = async (query: Parameters<InstanceType<typeof PgDialect>['sqlToQuery']>[0]) => {
    const { sql: text, params } = dialect.sqlToQuery(query)
    return run(text.replace(/\s+/g, ' ').trim(), params)
  }
  return {
    db: {
      execute: exec,
      transaction: async (fn: (tx: { execute: typeof exec }) => Promise<unknown>) => {
        const prev = state.lock
        let release!: () => void
        state.lock = new Promise<void>((resolve) => (release = resolve))
        await prev
        try {
          // Yield so interleaving would show up if the lock were missing
          await Promise.resolve()
          return await fn({ execute: exec })
        } finally {
          release()
        }
      },
    },
  }
})

const budget = await import('~/server/services/marketing/llm-budget')
const { currentPeriod } = await import('~/server/utils/marketing-usage')

const period = currentPeriod()
const reservedKey = (p = 'anthropic') => key('t1', period, `llm:${p}:reserved_usd_micros`)
const costKey = (p = 'anthropic') => key('t1', period, `llm:${p}:cost_usd_micros`)
const units = (k: string) => state.rows.get(k)?.units ?? 0

beforeEach(() => {
  state.rows.clear()
  state.statements = []
  state.lock = Promise.resolve()
})

describe('estimateMaxCostUsdMicros', () => {
  it('prices input, output and searches at their upper bounds', () => {
    // sonnet 5.5: $2/$10 per million, $0.01 per search
    expect(
      budget.estimateMaxCostUsdMicros('anthropic', 'claude-sonnet-5-5', {
        maxInputTokens: 1000,
        maxOutputTokens: 4096,
        maxSearches: 5,
      })
    ).toBe(1000 * 2 + 4096 * 10 + 5 * 10_000)
  })

  it('omits the search fee for calls without search', () => {
    expect(
      budget.estimateMaxCostUsdMicros('gemini', 'gemini-3.1-flash-lite', {
        maxInputTokens: 2000,
        maxOutputTokens: 2048,
      })
    ).toBe(Math.ceil(2000 * 0.25 + 2048 * 1.5))
  })

  it('sizes input at chars / 3 with a floor of 1000 tokens', () => {
    expect(budget.estimateInputTokens('x'.repeat(30))).toBe(1000)
    expect(budget.estimateInputTokens('x'.repeat(9000))).toBe(3000)
    expect(budget.estimateInputTokens('x'.repeat(9001))).toBe(3001)
  })

  it('reserves more for a visibility answer than for a bare extraction call', () => {
    const answer = budget.estimateVisibilityReservation('openai', 'gpt-6-astra', 'gpt-6-luna', 'prompt', 'system')
    const extract = budget.estimateTeamCallReservation('openai', { system: 's', input: 'i', schema: {} })
    expect(answer).toBeGreaterThan(extract)
  })

  it('holds nothing without a cap', () => {
    expect(budget.heldMicros(5000, null)).toBe(0)
    expect(budget.heldMicros(5000.2, 100)).toBe(5001)
  })
})

describe('guard arithmetic', () => {
  it('allows exactly up to the cap', () => {
    expect(budget.fitsBudget(600_000, 300_000, 100_000, 100)).toBe(true)
    expect(budget.fitsBudget(600_000, 300_000, 100_001, 100)).toBe(false)
    expect(budget.fitsBudget(1_000_000, 0, 0, 100)).toBe(true)
    expect(budget.fitsBudget(1_000_000, 0, 1, 100)).toBe(false)
  })
})

describe('reserveBudget', () => {
  it('succeeds without writing when there is no cap', async () => {
    await expect(budget.reserveBudget('t1', 'anthropic', 5_000_000, null)).resolves.toBe(true)
    expect(state.statements).toEqual([])
  })

  it('uses one guarded UPDATE comparing spent + reserved + amount with the cap in micros', async () => {
    await budget.reserveBudget('t1', 'anthropic', 250_000, 100)
    const guard = state.statements.find((s) => s.text.includes('RETURNING units'))!
    expect(guard.text).toMatch(/UPDATE marketing_usage/)
    expect(guard.text).toMatch(/units \+ \$5::bigint \+ COALESCE\(\(/)
    expect(guard.text).toMatch(/<= \$9::bigint/)
    // amount, team, period, reserved metric, amount, team, period, cost metric, cap
    expect(guard.params).toEqual([
      250_000,
      't1',
      period,
      'llm:anthropic:reserved_usd_micros',
      250_000,
      't1',
      period,
      'llm:anthropic:cost_usd_micros',
      1_000_000,
    ])
    // the row is locked by a separate no-op upsert first
    expect(state.statements[0].text).toMatch(/DO UPDATE SET units = marketing_usage.units$/)
  })

  it('counts settled spend and existing reservations', async () => {
    state.rows.set(costKey(), { units: 600_000, updatedAt: Date.now() })
    await expect(budget.reserveBudget('t1', 'anthropic', 300_000, 100)).resolves.toBe(true)
    await expect(budget.reserveBudget('t1', 'anthropic', 100_001, 100)).resolves.toBe(false)
    await expect(budget.reserveBudget('t1', 'anthropic', 100_000, 100)).resolves.toBe(true)
    expect(units(reservedKey())).toBe(400_000)
  })

  it('refuses when spend alone already reached the cap', async () => {
    state.rows.set(costKey(), { units: 1_000_000, updatedAt: Date.now() })
    await expect(budget.reserveBudget('t1', 'anthropic', 1, 100)).resolves.toBe(false)
    expect(units(reservedKey())).toBe(0)
  })

  it('keeps providers separate', async () => {
    state.rows.set(costKey('openai'), { units: 1_000_000, updatedAt: Date.now() })
    await expect(budget.reserveBudget('t1', 'anthropic', 500_000, 100)).resolves.toBe(true)
  })

  it('lets only as many concurrent reservations through as fit under the cap', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => budget.reserveBudget('t1', 'anthropic', 300_000, 100))
    )
    expect(results.filter(Boolean)).toHaveLength(3)
    expect(units(reservedKey())).toBe(900_000)
  })
})

describe('settleBudget and releaseBudget', () => {
  it('moves the reservation into spend using the actual cost', async () => {
    await budget.reserveBudget('t1', 'anthropic', 400_000, 100)
    await budget.settleBudget('t1', 'anthropic', 400_000, 12_345)
    expect(units(reservedKey())).toBe(0)
    expect(units(costKey())).toBe(12_345)
  })

  it('accumulates spend across settles and frees room for new reservations', async () => {
    await budget.reserveBudget('t1', 'anthropic', 600_000, 100)
    await budget.reserveBudget('t1', 'anthropic', 400_000, 100)
    await expect(budget.reserveBudget('t1', 'anthropic', 1, 100)).resolves.toBe(false)
    await budget.settleBudget('t1', 'anthropic', 600_000, 50_000)
    await budget.settleBudget('t1', 'anthropic', 400_000, 70_000)
    expect(units(costKey())).toBe(120_000)
    await expect(budget.reserveBudget('t1', 'anthropic', 800_000, 100)).resolves.toBe(true)
  })

  it('books actual spend above the reservation (overrun is recorded, not hidden)', async () => {
    await budget.reserveBudget('t1', 'anthropic', 100, 100)
    await budget.settleBudget('t1', 'anthropic', 100, 5_000)
    expect(units(costKey())).toBe(5_000)
    expect(units(reservedKey())).toBe(0)
  })

  it('releases without recording spend', async () => {
    await budget.reserveBudget('t1', 'anthropic', 400_000, 100)
    await budget.releaseBudget('t1', 'anthropic', 400_000)
    expect(units(reservedKey())).toBe(0)
    expect(state.rows.has(costKey())).toBe(false)
  })

  it('clamps at zero when a stale reset already cleared the counter', async () => {
    state.rows.set(reservedKey(), { units: 0, updatedAt: Date.now() })
    await budget.settleBudget('t1', 'anthropic', 400_000, 1_000)
    expect(units(reservedKey())).toBe(0)
    expect(units(costKey())).toBe(1_000)
  })

  it('is a no-op for an uncapped call that spent nothing, and books cost for one that did', async () => {
    await budget.settleBudget('t1', 'anthropic', 0, 0)
    expect(state.statements).toEqual([])
    await budget.settleBudget('t1', 'anthropic', 0, 700)
    expect(units(costKey())).toBe(700)
    expect(state.statements.some((s) => s.text.includes('GREATEST'))).toBe(false)
  })
})

describe('resetStaleReservations', () => {
  it('zeroes reserved counters idle for 15 minutes and leaves fresh ones and cost rows alone', async () => {
    const now = new Date('2026-10-11T12:00:00Z')
    const old = now.getTime() - 16 * 60_000
    const fresh = now.getTime() - 5 * 60_000
    state.rows.set(reservedKey('anthropic'), { units: 500, updatedAt: old })
    state.rows.set(reservedKey('openai'), { units: 700, updatedAt: fresh })
    state.rows.set(costKey('anthropic'), { units: 900, updatedAt: old })

    await expect(budget.resetStaleReservations(now)).resolves.toBe(1)
    expect(units(reservedKey('anthropic'))).toBe(0)
    expect(units(reservedKey('openai'))).toBe(700)
    expect(units(costKey('anthropic'))).toBe(900)
    expect(state.statements[0].params[0]).toBe('2026-10-11T11:45:00.000Z')
  })
})
