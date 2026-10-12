import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertedAnswers: [] as Array<Record<string, unknown>>,
  insertedRun: null as Record<string, unknown> | null,
  credentials: [] as Array<{ provider: string; status: string }>,
  updates: [] as Array<Record<string, unknown>>,
  executed: 0,
  executedSql: [] as unknown[],
  executeRows: [] as unknown[][],
  txError: null as unknown,
}))

function chain() {
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin', 'groupBy']) c[m] = () => c
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject)
  return c
}

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => chain(),
    selectDistinct: () => chain(),
    execute: async (query: unknown) => {
      state.executed++
      state.executedSql.push(query)
      return { rows: state.executeRows.shift() ?? [] }
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(values)
          return Promise.resolve()
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (state.txError) throw state.txError
      return fn({
        insert: () => ({
          values: (values: unknown) => {
            if (Array.isArray(values)) {
              state.insertedAnswers = values as Array<Record<string, unknown>>
              return Promise.resolve()
            }
            state.insertedRun = values as Record<string, unknown>
            return { returning: () => Promise.resolve([values]) }
          },
        }),
      })
    },
  },
}))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => state.credentials),
  getTeamApiKey: vi.fn(),
  markCredentialInvalid: vi.fn(),
  markCredentialValid: vi.fn(),
}))
vi.mock('~/server/utils/marketing-usage', () => ({
  getUsage: vi.fn(),
  recordUsage: vi.fn(),
  currentPeriod: () => '2026-10',
}))
vi.mock('~/lib/email', () => ({ sendMarketingCredentialInvalidEmail: vi.fn() }))

const {
  createRun,
  advanceVisibilityRuns,
  parseAbortCount,
  finalizeVisibilityRuns,
  sweepStuckVisibilityRuns,
  scheduleWeeklyVisibilityRuns,
  scheduleBatchForBacklog,
  createDefaultDeps,
  buildDueSitesQuery,
  allocateClaims,
  VisibilityRunError,
} = await import('~/server/services/marketing/visibility/runner')
const { LlmProviderError } = await import('~/server/services/llm/types')

type Deps = Parameters<typeof advanceVisibilityRuns>[1]

describe('createRun', () => {
  beforeEach(() => {
    state.selectQueue = []
    state.insertedAnswers = []
    state.insertedRun = null
    state.txError = null
    state.credentials = [
      { provider: 'anthropic', status: 'valid' },
      { provider: 'openai', status: 'unchecked' },
      { provider: 'firecrawl', status: 'valid' },
    ]
  })

  const site = [{ id: 's1', teamId: 't1', verifiedAt: new Date() }]

  it('rejects an unverified site', async () => {
    state.selectQueue = [[{ id: 's1', teamId: 't1', verifiedAt: null }]]
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toMatchObject({ code: 'site_unverified' })
  })

  it('requires a brand term', async () => {
    state.selectQueue = [site, []]
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toMatchObject({ code: 'no_brand' })
  })

  it('requires an active prompt', async () => {
    state.selectQueue = [site, [{ id: 'b1' }], []]
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toMatchObject({ code: 'no_prompts' })
  })

  it('requires a usable LLM key (invalid and non-LLM keys do not count)', async () => {
    state.credentials = [
      { provider: 'anthropic', status: 'invalid' },
      { provider: 'firecrawl', status: 'valid' },
    ]
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }]]
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toMatchObject({ code: 'no_key' })
  })

  it('allows at most one queued/running run per site', async () => {
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }], [{ id: 'r-active' }]]
    const err = await createRun({ siteId: 's1', trigger: 'manual' }).catch((e) => e)
    expect(err).toBeInstanceOf(VisibilityRunError)
    expect(err.code).toBe('already_running')
  })

  it.each([
    [Object.assign(new Error('dup'), { code: '23505' }), 'already_running'],
    [new Error('failed', { cause: { code: '23505' } }), 'already_running'],
  ])('maps a unique violation (23505) on insert to already_running', async (txError, code) => {
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }], []]
    state.txError = txError
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toMatchObject({ code })
  })

  it('rethrows other insert errors', async () => {
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }], []]
    state.txError = new Error('other')
    await expect(createRun({ siteId: 's1', trigger: 'manual' })).rejects.toThrow('other')
  })

  it('fans out one pending answer per prompt x provider x sample', async () => {
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }, { id: 'p2' }], []]
    const { run, answerCount } = await createRun({ siteId: 's1', trigger: 'manual' })

    expect(answerCount).toBe(2 * 2 * 3)
    expect(state.insertedAnswers).toHaveLength(12)
    expect(state.insertedAnswers.every((a) => a.status === 'pending' && a.runId === run.id)).toBe(true)
    expect(new Set(state.insertedAnswers.map((a) => a.provider))).toEqual(new Set(['anthropic', 'openai']))
    expect(new Set(state.insertedAnswers.map((a) => a.sample))).toEqual(new Set([1, 2, 3]))
    expect(state.insertedRun).toMatchObject({ status: 'queued', trigger: 'manual', samplesPerPrompt: 3 })
  })

  it('honours the provider filter and sample count', async () => {
    state.selectQueue = [site, [{ id: 'b1' }], [{ id: 'p1' }], []]
    const { answerCount } = await createRun({
      siteId: 's1',
      trigger: 'schedule',
      providers: ['openai'],
      samplesPerPrompt: 2,
    })
    expect(answerCount).toBe(2)
    expect(state.insertedAnswers.every((a) => a.provider === 'openai')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// advanceVisibilityRuns with injected dependencies
// ---------------------------------------------------------------------------

interface FakeAnswer {
  id: string
  runId: string
  promptId: string
  provider: 'anthropic' | 'openai'
  sample: number
  aborts?: number
}

function makeHarness(
  answers: FakeAnswer[],
  options: {
    key?: Record<string, unknown> | null
    usage?: Record<string, number>
    llm?: Partial<Record<'anthropic' | 'openai', Record<string, unknown>>>
  } = {}
) {
  const pending = new Map(answers.map((a) => [a.id, a]))
  const saved = new Map<string, Record<string, unknown>>()
  const failed = new Map<string, string>()
  const calls = {
    markInvalid: vi.fn(async () => true),
    markValid: vi.fn(async () => undefined),
    notifyInvalid: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    // Same guard as the SQL: spent + reserved + amount <= cap
    reserveBudget: vi.fn(async (_t: string, provider: string, amount: number, cap: number | null) => {
      if (cap == null) return true
      const usage = options.usage ?? {}
      return (
        (usage[`llm:${provider}:cost_usd_micros`] ?? 0) +
          (usage[`llm:${provider}:reserved_usd_micros`] ?? 0) +
          amount <=
        cap * 10_000
      )
    }),
    // Mirrors llm-budget: a refusal is a real cap only if spend alone plus this call exceeds it
    budgetRefusalReason: vi.fn(async (_t: string, provider: string, amount: number, cap: number) => {
      const usage = options.usage ?? {}
      return (usage[`llm:${provider}:cost_usd_micros`] ?? 0) + amount > cap * 10_000 ? 'cap' : 'in_flight'
    }),
    settleBudget: vi.fn(async () => undefined),
    releaseBudget: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined),
    answerWithSearch: vi.fn(),
    extractStructured: vi.fn(),
  }

  const okLlm = {
    answerWithSearch: async (...args: unknown[]) => {
      calls.answerWithSearch(...args)
      return {
        text: 'Try Acme or Veerify for feedback.',
        citations: [{ url: 'https://www.g2.com/x', title: 'G2' }],
        usage: { inputTokens: 1000, outputTokens: 500 },
        model: 'claude-sonnet-5-5',
      }
    },
    extractStructured: async (...args: unknown[]) => {
      calls.extractStructured(...args)
      return {
        data: { recommended: ['Acme', 'Veerify'], brandSentiment: 'positive' },
        usage: { inputTokens: 200, outputTokens: 50 },
        model: 'claude-haiku-4-5',
      }
    },
  }

  const deps = {
    now: () => Date.now(),
    claim: vi.fn(async (limit: number, exclude: string[]) => {
      const out = [...pending.values()].filter((a) => !exclude.includes(a.provider)).slice(0, limit)
      out.forEach((a) => pending.delete(a.id))
      // claimed rows stay "pending" in the DB, but the fake hands them out once
      out.forEach((a) => claimed.set(a.id, a))
      return out
    }),
    release: vi.fn(async (id: string) => {
      const a = claimed.get(id)!
      claimed.delete(id)
      released.push(a)
    }),
    markRunsRunning: vi.fn(async () => undefined),
    loadContext: vi.fn(async () => ({
      teamId: 't1',
      promptText: 'best feedback tool?',
      brandLabel: 'Veerify',
      terms: [
        { id: 'b', kind: 'brand', label: 'Veerify', aliases: [] },
        { id: 'c', kind: 'competitor', label: 'Acme', aliases: [] },
      ],
    })),
    getKey: vi.fn(async () =>
      options.key === undefined ? { apiKey: 'sk-secret', status: 'valid', monthlyBudgetCents: null } : options.key
    ),
    reserveBudget: calls.reserveBudget,
    budgetRefusalReason: calls.budgetRefusalReason,
    settleBudget: calls.settleBudget,
    releaseBudget: calls.releaseBudget,
    recordUsage: calls.recordUsage,
    markInvalid: calls.markInvalid,
    markValid: calls.markValid,
    notifyInvalid: calls.notifyInvalid,
    failAnswer: vi.fn(async (id: string, error: string) => {
      failed.set(id, error)
      claimed.delete(id)
    }),
    failPendingForProvider: vi.fn(async (runId: string, provider: string, error: string) => {
      for (const a of [...pending.values()]) {
        if (a.runId === runId && a.provider === provider) {
          pending.delete(a.id)
          failed.set(a.id, error)
        }
      }
    }),
    saveAnswer: vi.fn(async (id: string, data: Record<string, unknown>) => {
      saved.set(id, data)
      claimed.delete(id)
      return true
    }),
    finalizeRuns: calls.finalize,
    getProvider: (id: 'anthropic' | 'openai') => ({ ...okLlm, ...(options.llm?.[id] ?? {}) }),
  }
  const claimed = new Map<string, FakeAnswer>()
  const released: FakeAnswer[] = []
  return { deps: deps as unknown as Deps, state: { pending, saved, failed, released, claimed }, calls, raw: deps }
}

const mk = (id: string, provider: 'anthropic' | 'openai' = 'anthropic', runId = 'r1'): FakeAnswer => ({
  id,
  runId,
  promptId: 'p1',
  provider,
  sample: 1,
})

describe('advanceVisibilityRuns', () => {
  it('answers, extracts, analyses and records usage', async () => {
    const h = makeHarness([mk('a1')])
    const result = await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)

    expect(result).toEqual({ claimed: 1, done: 1, failed: 0 })
    const saved = h.state.saved.get('a1') as Record<string, any>
    expect(saved.analysis.brandMentioned).toBe(true)
    expect(saved.analysis.brandRank).toBe(2)
    expect(saved.analysis.brandSentiment).toBe('positive')
    expect(saved.analysis.competitorsMentioned).toHaveLength(1)
    expect(saved.analysis.citationDomains).toEqual(['g2.com'])
    expect(saved.inputTokens).toBe(1200)
    expect(saved.outputTokens).toBe(550)

    const metrics = Object.fromEntries(h.calls.recordUsage.mock.calls.map((c: unknown[]) => [c[1], c[2]]))
    expect(metrics['llm:anthropic:input_tokens']).toBe(1200)
    expect(metrics['llm:anthropic:output_tokens']).toBe(550)
    // sonnet 1000*2 + 500*10, haiku 200*1 + 50*5
    expect(metrics['llm:anthropic:cost_usd_micros']).toBeUndefined() // booked by settleBudget
    expect(h.calls.settleBudget).toHaveBeenCalledWith('t1', 'anthropic', 0, 7000 + 450)
    expect(metrics['visibility:answers']).toBe(1)
    expect(h.calls.finalize).toHaveBeenCalled()
  })

  it('still stores the answer when extraction fails', async () => {
    const h = makeHarness([mk('a1')], {
      llm: {
        anthropic: {
          extractStructured: async () => {
            throw new LlmProviderError('anthropic', 'server', 'boom', 500)
          },
        },
      },
    })
    const result = await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)

    expect(result.done).toBe(1)
    const saved = h.state.saved.get('a1') as Record<string, any>
    // deterministic fallback: Acme appears before Veerify
    expect(saved.analysis.brandMentioned).toBe(true)
    expect(saved.analysis.brandRank).toBe(2)
    expect(saved.analysis.brandSentiment).toBeNull()
    expect(saved.inputTokens).toBe(1000)
  })

  it('marks an unchecked key valid after a success', async () => {
    const h = makeHarness([mk('a1')], { key: { apiKey: 'k', status: 'unchecked', monthlyBudgetCents: null } })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.markValid).toHaveBeenCalledWith('t1', 'anthropic', undefined)
  })

  it('stops a provider at its monthly budget without calling it', async () => {
    const h = makeHarness([mk('a1'), mk('a2'), mk('a3', 'openai')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 100 },
      usage: { 'llm:anthropic:cost_usd_micros': 1_000_000, 'llm:openai:cost_usd_micros': 10 },
    })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 1 }, h.deps)

    expect(h.state.failed.get('a1')).toMatch(/budget/i)
    expect(h.state.failed.get('a2')).toMatch(/budget/i)
    expect(h.calls.answerWithSearch).toHaveBeenCalledTimes(1) // only openai
    expect(h.state.saved.has('a3')).toBe(true)
    expect(result.done).toBe(1)
  })

  it('reserves one upper bound per answer and settles the held amount with the actual cost', async () => {
    const h = makeHarness([mk('a1')], { key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 500 } })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)

    expect(h.calls.reserveBudget).toHaveBeenCalledTimes(1)
    const [teamId, provider, held, cap] = h.calls.reserveBudget.mock.calls[0] as unknown as [
      string,
      string,
      number,
      number,
    ]
    expect([teamId, provider, cap]).toEqual(['t1', 'anthropic', 500])
    expect(held).toBeGreaterThan(7450)
    expect(h.calls.settleBudget).toHaveBeenCalledWith('t1', 'anthropic', held, 7450)
    expect(h.calls.releaseBudget).not.toHaveBeenCalled()
  })

  it('settles only the answer cost when extraction fails', async () => {
    const h = makeHarness([mk('a1')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 500 },
      llm: {
        anthropic: {
          extractStructured: async () => {
            throw new LlmProviderError('anthropic', 'server', 'boom', 500)
          },
        },
      },
    })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.settleBudget).toHaveBeenCalledWith('t1', 'anthropic', expect.any(Number), 7000)
  })

  it('holds nothing when the key has no cap', async () => {
    const h = makeHarness([mk('a1')])
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.settleBudget).toHaveBeenCalledWith('t1', 'anthropic', 0, 7450)
  })

  it('releases the reservation when the provider fails before returning an answer', async () => {
    const h = makeHarness([mk('a1'), mk('a2')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 500 },
      llm: {
        anthropic: {
          answerWithSearch: async () => {
            throw new LlmProviderError('anthropic', 'rate_limit', 'slow', 429)
          },
        },
      },
    })
    await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 2 }, h.deps)
    expect(h.calls.reserveBudget).toHaveBeenCalledTimes(2)
    expect(h.calls.releaseBudget).toHaveBeenCalledTimes(2)
    expect(h.calls.settleBudget).not.toHaveBeenCalled()
  })

  it('releases the reservation when processing crashes after the reservation', async () => {
    const h = makeHarness([mk('a1')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 500 },
      llm: {
        anthropic: {
          answerWithSearch: async () => {
            throw new Error('network exploded')
          },
        },
      },
    })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.releaseBudget).toHaveBeenCalledTimes(1)
    expect(h.state.failed.get('a1')).toMatch(/unexpected/i)
  })

  it('leaves answers pending when only in-flight reservations block the budget', async () => {
    const h = makeHarness([mk('a1'), mk('a2')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 100 },
      usage: { 'llm:anthropic:reserved_usd_micros': 990_000 },
    })
    await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 1 }, h.deps)
    // Not failed: other answers' reservations may settle below the cap
    expect(h.state.failed.size).toBe(0)
    expect(h.calls.answerWithSearch).not.toHaveBeenCalled()
    expect(h.calls.releaseBudget).not.toHaveBeenCalled()
    expect(h.calls.budgetRefusalReason).toHaveBeenCalled()
  })

  it('fails answers when spend alone would exceed the cap', async () => {
    const h = makeHarness([mk('a1')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: 100 },
      usage: { 'llm:anthropic:cost_usd_micros': 999_999 },
    })
    await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 1 }, h.deps)
    expect(h.state.failed.get('a1')).toMatch(/budget/i)
    expect(h.calls.answerWithSearch).not.toHaveBeenCalled()
  })

  it('on auth error marks the key invalid, emails once and fails remaining pending answers', async () => {
    const authFail = {
      answerWithSearch: async () => {
        throw new LlmProviderError('anthropic', 'auth', 'bad key', 401)
      },
    }
    const h = makeHarness([mk('a1'), mk('a2'), mk('a3'), mk('o1', 'openai')], { llm: { anthropic: authFail } })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 3 }, h.deps)

    expect(h.calls.markInvalid).toHaveBeenCalledTimes(1)
    expect(h.calls.notifyInvalid).toHaveBeenCalledTimes(1)
    for (const id of ['a1', 'a2', 'a3']) expect(h.state.failed.has(id)).toBe(true)
    expect(h.state.saved.has('o1')).toBe(true)
    expect(result.done).toBe(1)
  })

  it('does not email when the credential was already invalid', async () => {
    const authFail = {
      answerWithSearch: async () => {
        throw new LlmProviderError('anthropic', 'auth', 'bad key', 401)
      },
    }
    const h = makeHarness([mk('a1')], { llm: { anthropic: authFail } })
    h.calls.markInvalid.mockResolvedValue(false)
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.notifyInvalid).not.toHaveBeenCalled()
  })

  it('fails answers without calling the provider when the stored key is already invalid', async () => {
    const h = makeHarness([mk('a1'), mk('a2')], { key: { apiKey: 'k', status: 'invalid', monthlyBudgetCents: null } })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.answerWithSearch).not.toHaveBeenCalled()
    expect(h.state.failed.size).toBe(2)
  })

  it('leaves answers pending on rate limit and stops that provider for the tick', async () => {
    const limited = {
      answerWithSearch: async () => {
        throw new LlmProviderError('anthropic', 'rate_limit', 'slow down', 429)
      },
    }
    const h = makeHarness([mk('a1'), mk('a2'), mk('a3')], { llm: { anthropic: limited } })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 3 }, h.deps)

    expect(h.state.failed.size).toBe(0)
    expect(h.state.saved.size).toBe(0)
    expect(h.state.released.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(h.calls.markInvalid).not.toHaveBeenCalled()
    expect(result).toEqual({ claimed: 3, done: 0, failed: 0 })
    // excluded from later claims in this tick
    expect(h.raw.claim).toHaveBeenLastCalledWith(expect.any(Number), ['anthropic'], expect.any(Object))
  })

  it('fails an answer on other provider errors without touching the credential', async () => {
    const h = makeHarness([mk('a1')], {
      llm: {
        anthropic: {
          answerWithSearch: async () => {
            throw new LlmProviderError('anthropic', 'server', 'oops', 503)
          },
        },
      },
    })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.state.failed.get('a1')).toContain('server')
    expect(h.calls.markInvalid).not.toHaveBeenCalled()
  })

  it('stops claiming once the time budget is spent', async () => {
    const h = makeHarness([mk('a1'), mk('a2')])
    let t = 0
    ;(h.raw as { now: () => number }).now = () => (t += 100)
    const result = await advanceVisibilityRuns({ budgetMs: 150, concurrency: 1 }, h.deps)
    expect(result.claimed).toBeLessThan(2)
  })
})

describe('advanceVisibilityRuns resilience and deadlines', () => {
  it('survives a failing release (rate limited provider) without aborting the tick', async () => {
    const limited = {
      answerWithSearch: async () => {
        throw new LlmProviderError('anthropic', 'rate_limit', 'slow down', 429)
      },
    }
    const h = makeHarness([mk('a1'), mk('a2'), mk('o1', 'openai')], { llm: { anthropic: limited } })
    ;(h.raw as { release: unknown }).release = vi.fn(async () => {
      throw new Error('db down')
    })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 3 }, h.deps)
    expect(result.claimed).toBe(3)
    // the unaffected provider still finished
    expect(h.state.saved.has('o1')).toBe(true)
  })

  it('does not claim new answers when less than the claim cutoff of the budget remains', async () => {
    const h = makeHarness([mk('a1'), mk('a2')])
    // a 45 s budget with a 20 s cutoff: claiming stops after 25 s; the clock jumps to 30 s after the first reading
    let t = 0
    ;(h.raw as { now: () => number }).now = () => {
      const v = t
      t = 30_000
      return v
    }
    const result = await advanceVisibilityRuns({ budgetMs: 45_000 }, h.deps)
    expect(result.claimed).toBe(0)
    expect(h.raw.claim).not.toHaveBeenCalled()
  })

  it('passes an abort signal to provider calls that fires at the hard deadline, and releases the cut-off answer', async () => {
    let seen: AbortSignal | undefined
    const slow = {
      answerWithSearch: (input: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          seen = input.signal
          input.signal?.addEventListener('abort', () =>
            reject(new LlmProviderError('anthropic', 'timeout', 'aborted by caller'))
          )
        }),
    }
    const h = makeHarness([mk('a1')], { llm: { anthropic: slow } })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, hardDeadlineExtraMs: -4950 }, h.deps)
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen?.aborted).toBe(true)
    // cut off by our deadline: back to the queue, not failed
    expect(h.state.released.map((a) => a.id)).toEqual(['a1'])
    expect(h.state.failed.size).toBe(0)
    expect(result).toEqual({ claimed: 1, done: 0, failed: 0 })
  })

  describe('hard-deadline abort retries', () => {
    const slow = {
      answerWithSearch: (input: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () =>
            reject(new LlmProviderError('anthropic', 'timeout', 'aborted by caller'))
          )
        }),
    }

    it('records the abort count when releasing a cut-off answer', async () => {
      const h = makeHarness([{ ...mk('a1'), aborts: 1 }], { llm: { anthropic: slow } })
      await advanceVisibilityRuns({ budgetMs: 5000, hardDeadlineExtraMs: -4950 }, h.deps)
      expect(h.raw.release).toHaveBeenCalledWith('a1', 'deadline-abort:2')
      expect(h.state.failed.size).toBe(0)
    })

    it('fails the answer with a clear error after the third abort', async () => {
      const h = makeHarness([{ ...mk('a1'), aborts: 2 }], { llm: { anthropic: slow } })
      const result = await advanceVisibilityRuns({ budgetMs: 5000, hardDeadlineExtraMs: -4950 }, h.deps)
      expect(h.state.released).toHaveLength(0)
      expect(h.state.failed.get('a1')).toMatch(/did not answer in time after 3 attempts/)
      expect(result).toEqual({ claimed: 1, done: 0, failed: 1 })
    })

    it('parses the counter from the error field', () => {
      expect(parseAbortCount('deadline-abort:2')).toBe(2)
      expect(parseAbortCount(null)).toBe(0)
      expect(parseAbortCount('Provider error')).toBe(0)
    })
  })

  it('passes the signal to the extraction call too', async () => {
    const h = makeHarness([mk('a1')])
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect((h.calls.answerWithSearch.mock.calls[0][0] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
    expect((h.calls.extractStructured.mock.calls[0][0] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
  })

  it('defaults to 24 answers in flight and 8 per provider', async () => {
    const h = makeHarness([])
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    const [limit, , capacity] = (h.raw.claim as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(limit).toBe(24)
    expect(capacity.anthropic).toBe(8)
  })
})

describe('provider-first pending index', () => {
  it('claims per provider, oldest first, in the order of the (provider, created_at, id) partial index', async () => {
    state.executed = 0
    state.executedSql = []
    state.executeRows = [[], []]
    const deps = createDefaultDeps()
    await deps.claim(6, [], { anthropic: 3, openai: 3, perplexity: 0, gemini: 0 })
    expect(state.executedSql).toHaveLength(2)
    for (const query of state.executedSql) {
      const { sql: text } = render(query)
      expect(text).toMatch(/a\.status = 'pending'\s+AND a\.provider = \$\d+/)
      expect(text).toMatch(/ORDER BY a\.created_at ASC, a\.id ASC/)
    }
  })

  it('declares the partial index with provider as the leading column', async () => {
    const { getTableConfig } = await import('drizzle-orm/pg-core')
    const { aiVisibilityAnswer } = await import('~/server/database/schema/marketing')
    const idx = getTableConfig(aiVisibilityAnswer).indexes.find(
      (i) => i.config.name === 'ai_visibility_answer_pending_idx'
    )
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['provider', 'created_at', 'id'])
    expect(idx?.config.where).toBeDefined()
  })
})

describe('advanceVisibilityRuns hardening', () => {
  it('runs the stuck-run sweep at the start of every tick, even with nothing to claim', async () => {
    const h = makeHarness([])
    const sweep = vi.fn(async () => undefined)
    ;(h.raw as Record<string, unknown>).sweepStuckRuns = sweep
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('on quota fails that provider pending answers without marking the key invalid', async () => {
    const quota = {
      answerWithSearch: async () => {
        throw new LlmProviderError('openai', 'quota', 'insufficient_quota', 429)
      },
    }
    const h = makeHarness([mk('o1', 'openai'), mk('o2', 'openai'), mk('a1')], { llm: { openai: quota } })
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 1 }, h.deps)
    expect(h.state.failed.get('o1')).toMatch(/out of credit or quota/)
    expect(h.state.failed.get('o2')).toMatch(/out of credit or quota/)
    expect(h.state.saved.has('a1')).toBe(true)
    expect(h.calls.markInvalid).not.toHaveBeenCalled()
    expect(h.calls.notifyInvalid).not.toHaveBeenCalled()
    expect(result.done).toBe(1)
  })

  it('does not call providers when marketing is off or the site is unverified', async () => {
    for (const reason of ['Marketing is turned off for this product', 'Site is no longer verified']) {
      const h = makeHarness([mk('a1'), mk('a2')])
      ;(h.raw as { loadContext: unknown }).loadContext = vi.fn(async () => ({
        teamId: 't1',
        promptText: 'q',
        brandLabel: 'Veerify',
        terms: [],
        blockedReason: reason,
      }))
      await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
      expect(h.calls.answerWithSearch).not.toHaveBeenCalled()
      expect(h.state.failed.get('a1')).toBe(reason)
      expect(h.state.failed.get('a2')).toBe(reason)
    }
  })

  it('prices by the requested model and counts web search fees', async () => {
    const h = makeHarness([mk('a1')], {
      llm: {
        anthropic: {
          answerWithSearch: async (input: { model?: string }) => {
            expect(input.model).toBe('claude-sonnet-5-5')
            return {
              text: 'Veerify',
              citations: [],
              usage: { inputTokens: 1000, outputTokens: 0, webSearchRequests: 2 },
              model: 'some-unlisted-snapshot',
            }
          },
        },
      },
    })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    // sonnet 1000*2 + 2 searches * 10_000, + haiku extraction 200*1 + 50*5
    expect(h.calls.settleBudget).toHaveBeenCalledWith('t1', 'anthropic', 0, 2000 + 20_000 + 450)
  })

  it('ignores an answer another worker already settled (no done count, no key update)', async () => {
    const h = makeHarness([mk('a1')], { key: { apiKey: 'k', status: 'unchecked', monthlyBudgetCents: null } })
    ;(h.raw as { saveAnswer: unknown }).saveAnswer = vi.fn(async () => false)
    const result = await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(result.done).toBe(0)
    expect(h.calls.markValid).not.toHaveBeenCalled()
  })

  it('passes the used key hint so a replaced key is not marked', async () => {
    const authFail = {
      answerWithSearch: async () => {
        throw new LlmProviderError('anthropic', 'auth', 'bad key', 401)
      },
    }
    const h = makeHarness([mk('a1')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: null, keyHint: '...abcd' },
      llm: { anthropic: authFail },
    })
    await advanceVisibilityRuns({ budgetMs: 5000 }, h.deps)
    expect(h.calls.markInvalid).toHaveBeenCalledWith('t1', 'anthropic', expect.any(String), '...abcd')
  })
})

const dialect = new PgDialect()
const render = (query: unknown) => dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0])

describe('finalizeVisibilityRuns (set-based)', () => {
  beforeEach(() => {
    state.executed = 0
    state.executedSql = []
    state.executeRows = []
  })

  it('does nothing for an empty id list', async () => {
    await finalizeVisibilityRuns([])
    expect(state.executed).toBe(0)
  })

  it('finalizes in ONE statement computed from the answer counts, only runs with nothing pending', async () => {
    await finalizeVisibilityRuns(['r1', 'r2'])
    expect(state.executed).toBe(1)
    const { sql: text, params } = render(state.executedSql[0])
    expect(text).toMatch(/UPDATE ai_visibility_run r/)
    expect(text).toMatch(/WHEN c\.total = 0 THEN 'failed'/)
    expect(text).toMatch(/WHEN c\.failed = 0 THEN 'done'/)
    expect(text).toMatch(/WHEN c\.done = 0 THEN 'failed'/)
    expect(text).toMatch(/ELSE 'partial'/)
    expect(text).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM ai_visibility_answer p WHERE p\.run_id = r2\.id AND p\.status = 'pending'/
    )
    expect(text).toMatch(/r\.status IN \('queued', 'running'\)/)
    expect(params).toEqual(expect.arrayContaining(['r1', 'r2']))
  })

  it('without ids covers every queued/running run (no id filter)', async () => {
    await finalizeVisibilityRuns()
    const { sql: text } = render(state.executedSql[0])
    expect(text).not.toMatch(/r2\.id IN/)
  })

  // Reference implementation of the CASE in the statement, to pin the done/partial/failed semantics
  it.each([
    [{ total: 6, done: 6, failed: 0 }, 'done'],
    [{ total: 6, done: 4, failed: 2 }, 'partial'],
    [{ total: 6, done: 0, failed: 6 }, 'failed'],
    [{ total: 0, done: 0, failed: 0 }, 'failed'],
  ])('status rule for %j is %s', (counts, expected) => {
    const status =
      counts.total === 0 ? 'failed' : counts.failed === 0 ? 'done' : counts.done === 0 ? 'failed' : 'partial'
    expect(status).toBe(expected)
  })

  it('applies retention for the finished runs sites with one statement', async () => {
    state.executeRows = [
      [
        { id: 'r1', site_id: 's1' },
        { id: 'r2', site_id: 's2' },
        { id: 'r3', site_id: 's1' },
      ],
    ]
    await finalizeVisibilityRuns(['r1', 'r2', 'r3'])
    expect(state.executed).toBe(2)
    const { sql: text, params } = render(state.executedSql[1])
    expect(text).toMatch(/DELETE FROM ai_visibility_run/)
    expect(text).toMatch(/row_number\(\) OVER \(PARTITION BY site_id/)
    expect(params).toEqual(expect.arrayContaining(['s1', 's2', 12]))
  })

  it('skips retention when nothing was finalized', async () => {
    await finalizeVisibilityRuns(['r1'])
    expect(state.executed).toBe(1)
  })
})

describe('sweepStuckVisibilityRuns', () => {
  beforeEach(() => {
    state.executed = 0
    state.executedSql = []
    state.executeRows = []
  })

  it('times out old pending answers via the pending partial index range, then finalizes all active runs', async () => {
    await sweepStuckVisibilityRuns(new Date('2026-10-12T00:00:00Z'))
    expect(state.executed).toBe(2)
    const timeout = render(state.executedSql[0])
    expect(timeout.sql).toMatch(/UPDATE ai_visibility_answer/)
    // provider first, then the created_at range: matches the (provider, created_at, id) partial index
    expect(timeout.sql).toMatch(
      /status = 'pending'\s+AND provider IN \(\$\d+, \$\d+, \$\d+, \$\d+\)\s+AND created_at </
    )
    expect(timeout.params).toContain('2026-10-11T00:00:00.000Z')
    expect(render(state.executedSql[1]).sql).toMatch(/UPDATE ai_visibility_run r/)
  })
})

describe('advanceVisibilityRuns concurrency', () => {
  const many = (n: number, provider: 'anthropic' | 'openai') =>
    Array.from({ length: n }, (_, i) => mk(`${provider}-${i}`, provider))

  /** claim that honours the per-provider capacity like the real one */
  function capacityClaim(h: ReturnType<typeof makeHarness>) {
    h.raw.claim = vi.fn(async (limit: number, exclude: string[], capacity: Record<string, number>) => {
      const alloc = allocateClaims(limit, capacity, exclude)
      const out: FakeAnswer[] = []
      for (const [provider, count] of Object.entries(alloc)) {
        const rows = [...h.state.pending.values()].filter((a) => a.provider === provider).slice(0, count)
        rows.forEach((a) => {
          h.state.pending.delete(a.id)
          h.state.claimed.set(a.id, a)
        })
        out.push(...rows)
      }
      return out
    }) as never
  }

  function trackedLlm(
    track: { now: number; max: number; byProvider: Record<string, number>; maxBy: Record<string, number> },
    provider: string,
    work: () => Promise<void>
  ) {
    return {
      answerWithSearch: async () => {
        track.now++
        track.max = Math.max(track.max, track.now)
        track.byProvider[provider] = (track.byProvider[provider] ?? 0) + 1
        track.maxBy[provider] = Math.max(track.maxBy[provider] ?? 0, track.byProvider[provider])
        await work()
        track.now--
        track.byProvider[provider]--
        return { text: 'Veerify', citations: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'm' }
      },
    }
  }

  it('never exceeds the overall or the per-provider concurrency', async () => {
    const track = { now: 0, max: 0, byProvider: {} as Record<string, number>, maxBy: {} as Record<string, number> }
    const tick = () => new Promise<void>((r) => setTimeout(r, 5))
    const h = makeHarness([...many(10, 'anthropic'), ...many(10, 'openai')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: null },
      llm: { anthropic: trackedLlm(track, 'anthropic', tick), openai: trackedLlm(track, 'openai', tick) },
    })
    capacityClaim(h)
    const result = await advanceVisibilityRuns({ budgetMs: 5000, concurrency: 5, perProviderConcurrency: 3 }, h.deps)
    expect(result.done).toBe(20)
    expect(track.max).toBeLessThanOrEqual(5)
    expect(track.maxBy.anthropic).toBeLessThanOrEqual(3)
    expect(track.maxBy.openai).toBeLessThanOrEqual(3)
    // and it really ran in parallel
    expect(track.max).toBeGreaterThan(1)
  })

  it('a slow provider only holds its own slots; the other keeps finishing work', async () => {
    let releaseSlow: () => void = () => undefined
    const gate = new Promise<void>((r) => (releaseSlow = r))
    const track = { now: 0, max: 0, byProvider: {} as Record<string, number>, maxBy: {} as Record<string, number> }
    const h = makeHarness([...many(6, 'anthropic'), ...many(6, 'openai')], {
      key: { apiKey: 'k', status: 'valid', monthlyBudgetCents: null },
      llm: {
        anthropic: trackedLlm(track, 'anthropic', () => gate),
        openai: trackedLlm(track, 'openai', async () => undefined),
      },
    })
    capacityClaim(h)
    const run = advanceVisibilityRuns({ budgetMs: 5000, concurrency: 8, perProviderConcurrency: 2 }, h.deps)
    // Wait until every openai answer is saved while anthropic is still stuck
    for (let i = 0; i < 200 && [...h.state.saved.keys()].filter((id) => id.startsWith('openai')).length < 6; i++) {
      await new Promise((r) => setTimeout(r, 2))
    }
    expect([...h.state.saved.keys()].filter((id) => id.startsWith('openai'))).toHaveLength(6)
    expect(h.state.saved.size).toBe(6)
    expect(track.maxBy.anthropic).toBe(2)
    releaseSlow()
    const result = await run
    expect(result.done).toBe(12)
  })

  it('allocateClaims splits slots round-robin within each provider capacity and skips stopped providers', () => {
    expect(allocateClaims(6, { a: 4, b: 4 })).toEqual({ a: 3, b: 3 })
    expect(allocateClaims(6, { a: 1, b: 4 })).toEqual({ a: 1, b: 4 })
    expect(allocateClaims(6, { a: 4, b: 4 }, ['a'])).toEqual({ b: 4 })
    expect(allocateClaims(3, { a: 0, b: 0 })).toEqual({})
  })
})

describe('scheduleWeeklyVisibilityRuns', () => {
  const NOW = new Date('2026-10-12T10:00:00Z')

  it('selects due sites with the 7 day cutoff and a 150 site limit, then creates one run each', async () => {
    const selectDueSites = vi.fn(async () => ['s1', 's2', 's3'])
    const createRunFake = vi.fn(async (input: { siteId: string }) => {
      if (input.siteId === 's2') throw new VisibilityRunError('already_running', 'x')
      if (input.siteId === 's3') throw new Error('boom')
    })
    const result = await scheduleWeeklyVisibilityRuns(NOW, { selectDueSites, createRun: createRunFake })
    expect(selectDueSites).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * 24 * 3600 * 1000), 150)
    expect(createRunFake).toHaveBeenCalledTimes(3)
    expect(createRunFake).toHaveBeenCalledWith({ siteId: 's1', trigger: 'schedule' })
    expect(result).toEqual({ created: 1, skipped: 2 })
  })

  it('creates no runs while the pending-answer backlog is at the limit', async () => {
    const selectDueSites = vi.fn(async () => ['s1'])
    const createRunFake = vi.fn()
    const result = await scheduleWeeklyVisibilityRuns(NOW, {
      countPendingAnswers: async () => 5000,
      selectDueSites,
      createRun: createRunFake,
    })
    expect(result).toEqual({ created: 0, skipped: 0, backlog: { pending: 5000, batch: 0 } })
    expect(selectDueSites).not.toHaveBeenCalled()
    expect(createRunFake).not.toHaveBeenCalled()
  })

  it('shrinks the batch as the backlog approaches the limit and uses the full batch when it is small', async () => {
    expect(scheduleBatchForBacklog(0)).toBe(150)
    expect(scheduleBatchForBacklog(2500)).toBe(150)
    expect(scheduleBatchForBacklog(3750)).toBe(75)
    expect(scheduleBatchForBacklog(4999)).toBe(1)
    expect(scheduleBatchForBacklog(9000)).toBe(0)

    const selectDueSites = vi.fn(async () => [])
    await scheduleWeeklyVisibilityRuns(NOW, {
      countPendingAnswers: async () => 3750,
      selectDueSites,
      createRun: vi.fn(),
    })
    expect(selectDueSites).toHaveBeenCalledWith(expect.any(Date), 75)
  })

  it('counts the backlog with a bounded query', async () => {
    state.executed = 0
    state.executedSql = []
    state.executeRows = [[{ n: 42 }], []]
    const created = await scheduleWeeklyVisibilityRuns(NOW)
    expect(created).toEqual({ created: 0, skipped: 0 })
    const count = render(state.executedSql[0])
    expect(count.sql).toMatch(/SELECT 1 FROM ai_visibility_answer WHERE status = 'pending' LIMIT \$1/)
    expect(count.params).toEqual([5000])
  })

  it('makes no per-site queries of its own', async () => {
    state.executed = 0
    const result = await scheduleWeeklyVisibilityRuns(NOW, { selectDueSites: async () => [], createRun: vi.fn() })
    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(state.executed).toBe(0)
  })

  it('selects eligibility in SQL: gates, prerequisites, no recent run, NULLS FIRST order, limit', () => {
    const { sql: text, params } = render(buildDueSitesQuery(new Date('2026-10-05T10:00:00Z'), 150))
    expect(text).toMatch(/s\.verified_at IS NOT NULL/)
    expect(text).toMatch(/t\.marketing_enabled = true/)
    expect(text).toMatch(/p\.settings ->> 'marketingEnabled' = 'true'/)
    expect(text).toMatch(/lr\.last_at IS NULL OR lr\.last_at </)
    expect(text).toMatch(/EXISTS \(SELECT 1 FROM marketing_term mt WHERE mt\.site_id = s\.id AND mt\.kind = 'brand'\)/)
    expect(text).toMatch(
      /EXISTS \(SELECT 1 FROM ai_visibility_prompt ap WHERE ap\.site_id = s\.id AND ap\.active = true\)/
    )
    expect(text).toMatch(/c\.status <> 'invalid'/)
    expect(text).toMatch(/ORDER BY lr\.last_at ASC NULLS FIRST/)
    expect(text).toMatch(/LIMIT \$\d+/)
    expect(params).toEqual(expect.arrayContaining(['2026-10-05T10:00:00.000Z', 150, 'anthropic', 'openai']))
  })
})
