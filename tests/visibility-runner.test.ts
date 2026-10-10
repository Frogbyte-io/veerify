import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertedAnswers: [] as Array<Record<string, unknown>>,
  insertedRun: null as Record<string, unknown> | null,
  credentials: [] as Array<{ provider: string; status: string }>,
  updates: [] as Array<Record<string, unknown>>,
}))

function chain() {
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'groupBy']) c[m] = () => c
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject)
  return c
}

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => chain(),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(values)
          return Promise.resolve()
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
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
      }),
  },
}))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => state.credentials),
  getTeamApiKey: vi.fn(),
  markCredentialInvalid: vi.fn(),
  markCredentialValid: vi.fn(),
}))
vi.mock('~/server/utils/marketing-usage', () => ({ getUsage: vi.fn(), recordUsage: vi.fn() }))
vi.mock('~/lib/email', () => ({ sendMarketingCredentialInvalidEmail: vi.fn() }))

const { createRun, advanceVisibilityRuns, finalizeVisibilityRuns, VisibilityRunError } =
  await import('~/server/services/marketing/visibility/runner')
const { LlmProviderError } = await import('~/server/services/llm/types')

type Deps = Parameters<typeof advanceVisibilityRuns>[1]

describe('createRun', () => {
  beforeEach(() => {
    state.selectQueue = []
    state.insertedAnswers = []
    state.insertedRun = null
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
    getUsage: vi.fn(async () => options.usage ?? {}),
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
    expect(metrics['llm:anthropic:cost_usd_micros']).toBe(7000 + 450)
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
    expect(h.calls.markValid).toHaveBeenCalledWith('t1', 'anthropic')
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
    expect(h.raw.claim).toHaveBeenLastCalledWith(3, ['anthropic'])
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

describe('finalizeVisibilityRuns', () => {
  beforeEach(() => {
    state.selectQueue = []
    state.updates = []
  })

  const row = (pending: number, done: number, failed: number) => ({ runId: 'r1', pending, done, failed })

  it('leaves a run with pending answers untouched', async () => {
    state.selectQueue = [[row(2, 3, 0)]]
    await finalizeVisibilityRuns(['r1'])
    expect(state.updates).toHaveLength(0)
  })

  it.each([
    [row(0, 6, 0), 'done'],
    [row(0, 4, 2), 'partial'],
    [row(0, 0, 6), 'failed'],
  ])('sets the status from the answer counts', async (counts, expected) => {
    state.selectQueue = [[counts]]
    await finalizeVisibilityRuns(['r1'])
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].status).toBe(expected)
    expect(state.updates[0].finishedAt).toBeInstanceOf(Date)
  })
})
