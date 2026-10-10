import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('h3', () => ({
  createError: (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

const { runCustomerLanguage, MAX_RUNS_PER_DAY } = await import('~/server/services/marketing/customer-language/service')
const { LlmProviderError } = await import('~/server/services/llm')

type Deps = Parameters<typeof runCustomerLanguage>[1]

const NOW = new Date('2026-10-10T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function items(source: 'feedback' | 'support', n: number, age = 1) {
  return Array.from({ length: n }, (_, i) => ({
    source,
    text: `${source} message number ${i} about slow exports`,
    createdAt: daysAgo(age),
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractStructured = vi.fn<(...args: any[]) => Promise<any>>()
const record = vi.fn(async (_teamId: string, _metric: string, _units: number) => undefined)
const saveInsight = vi.fn(async () => undefined)
const markInvalid = vi.fn(async () => true)
const notifyInvalid = vi.fn(async () => undefined)
const collectFeedback = vi.fn<NonNullable<Deps>['collectFeedback']>()
const collectSupport = vi.fn<NonNullable<Deps>['collectSupport']>()

function makeDeps(overrides: Partial<NonNullable<Deps>> = {}): NonNullable<Deps> {
  return {
    readConsent: async () => ({ allowFeedbackText: true, allowSupportText: true }),
    collectFeedback,
    collectSupport,
    listCredentials: async () => [{ provider: 'anthropic', status: 'valid' }],
    getKey: async () => ({ apiKey: 'sk-test', keyHint: 'abcd', monthlyBudgetCents: null }),
    getUsage: async () => ({}),
    countRecentRuns: async () => 0,
    termLabels: async () => ['existing'],
    getProvider: () => ({ extractStructured }) as never,
    record,
    saveInsight,
    markInvalid,
    notifyInvalid,
    now: () => NOW,
    ...overrides,
  }
}

const input = { projectId: 'p1', siteId: 's1', teamId: 't1', userId: 'u1', productName: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  collectFeedback.mockResolvedValue(items('feedback', 12))
  collectSupport.mockResolvedValue(items('support', 12))
  extractStructured.mockResolvedValue({
    data: {
      phrases: [{ phrase: 'slow exports', kind: 'pain', mentions: 5 }],
      suggestedTerms: [
        { kind: 'keyword', label: 'slow exports' },
        { kind: 'keyword', label: 'Existing' },
      ],
      suggestedPrompts: ['How do I speed up exporting large reports?'],
    },
    usage: { inputTokens: 1000, outputTokens: 200 },
    model: 'claude-x',
  })
})

describe('consent gating', () => {
  it('feedback only: collects feedback, never support', async () => {
    const result = await runCustomerLanguage(
      input,
      makeDeps({ readConsent: async () => ({ allowFeedbackText: true, allowSupportText: false }) })
    )
    expect(collectFeedback).toHaveBeenCalledTimes(1)
    expect(collectSupport).not.toHaveBeenCalled()
    expect(result.sources).toEqual(['feedback'])
    const sent = extractStructured.mock.calls[0][0].input as string
    expect(sent).toContain('[feedback]')
    expect(sent).not.toContain('[support]')
  })

  it('support only: collects support, never feedback', async () => {
    const result = await runCustomerLanguage(
      input,
      makeDeps({ readConsent: async () => ({ allowFeedbackText: false, allowSupportText: true }) })
    )
    expect(collectSupport).toHaveBeenCalledTimes(1)
    expect(collectFeedback).not.toHaveBeenCalled()
    expect(result.sources).toEqual(['support'])
    expect(extractStructured.mock.calls[0][0].input).not.toContain('[feedback]')
  })

  it('no consent: 409, no text collected, provider never called', async () => {
    await expect(
      runCustomerLanguage(
        input,
        makeDeps({ readConsent: async () => ({ allowFeedbackText: false, allowSupportText: false }) })
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(collectFeedback).not.toHaveBeenCalled()
    expect(collectSupport).not.toHaveBeenCalled()
    expect(extractStructured).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('re-reads consent on every run (revocation takes effect immediately)', async () => {
    let allowed = true
    const deps = makeDeps({ readConsent: async () => ({ allowFeedbackText: allowed, allowSupportText: false }) })
    await runCustomerLanguage(input, deps)
    allowed = false
    await expect(runCustomerLanguage(input, deps)).rejects.toMatchObject({ statusCode: 409 })
    expect(extractStructured).toHaveBeenCalledTimes(1)
  })

  it('drops items from a non-consented source even if a collector returned them', async () => {
    collectFeedback.mockResolvedValue([...items('feedback', 12), ...items('support', 5)])
    await runCustomerLanguage(
      input,
      makeDeps({ readConsent: async () => ({ allowFeedbackText: true, allowSupportText: false }) })
    )
    expect(extractStructured.mock.calls[0][0].input).not.toContain('[support]')
  })
})

describe('items', () => {
  it('excludes items older than 90 days', async () => {
    collectFeedback.mockResolvedValue([...items('feedback', 5), ...items('feedback', 20, 120)])
    await expect(
      runCustomerLanguage(
        input,
        makeDeps({ readConsent: async () => ({ allowFeedbackText: true, allowSupportText: false }) })
      )
    ).rejects.toMatchObject({ statusCode: 409, data: { error: { details: { reason: 'too_few_items' } } } })
    expect(extractStructured).not.toHaveBeenCalled()
    // window passed to the collector is 90 days before now
    expect(collectFeedback.mock.calls[0][1].getTime()).toBe(daysAgo(90).getTime())
  })

  it('refuses fewer than 10 items without calling the provider', async () => {
    collectFeedback.mockResolvedValue(items('feedback', 9))
    collectSupport.mockResolvedValue([])
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 409 })
    expect(extractStructured).not.toHaveBeenCalled()
  })

  it('passes product scope to collectors', async () => {
    await runCustomerLanguage(input, makeDeps())
    expect(collectFeedback.mock.calls[0][0]).toBe('p1')
    expect(collectSupport.mock.calls[0].slice(0, 2)).toEqual(['t1', 'p1'])
  })

  it('caps the input at 300 items', async () => {
    collectFeedback.mockResolvedValue(items('feedback', 400).map((i, n) => ({ ...i, text: `${i.text} unique ${n}` })))
    const result = await runCustomerLanguage(input, makeDeps())
    expect(result.itemCount).toBeLessThanOrEqual(300)
  })
})

describe('provider, budget and limits', () => {
  it('stores the insight, filters existing terms and records usage', async () => {
    const result = await runCustomerLanguage(input, makeDeps())
    expect(result.suggestedTerms).toEqual([{ kind: 'keyword', label: 'slow exports' }])
    expect(saveInsight).toHaveBeenCalledTimes(1)
    const metrics = record.mock.calls.map((c) => c[1])
    expect(metrics).toEqual(
      expect.arrayContaining([
        'llm:anthropic:input_tokens',
        'llm:anthropic:output_tokens',
        'llm:anthropic:cost_usd_micros',
        'language:runs',
      ])
    )
  })

  it('falls back to openai and skips an invalid anthropic key', async () => {
    const getProvider = vi.fn(() => ({ extractStructured }) as never)
    await runCustomerLanguage(
      input,
      makeDeps({
        listCredentials: async () => [
          { provider: 'anthropic', status: 'invalid' },
          { provider: 'openai', status: 'valid' },
        ],
        getProvider,
      })
    )
    expect(getProvider).toHaveBeenCalledWith('openai')
  })

  it('409 without a usable key and never reads customer text', async () => {
    await expect(runCustomerLanguage(input, makeDeps({ listCredentials: async () => [] }))).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(collectFeedback).not.toHaveBeenCalled()
    expect(extractStructured).not.toHaveBeenCalled()
  })

  it('409 when the monthly budget is exhausted', async () => {
    await expect(
      runCustomerLanguage(
        input,
        makeDeps({
          getKey: async () => ({ apiKey: 'k', keyHint: 'h', monthlyBudgetCents: 100 }),
          getUsage: async () => ({ 'llm:anthropic:cost_usd_micros': 1_000_000 }),
        })
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(collectFeedback).not.toHaveBeenCalled()
    expect(extractStructured).not.toHaveBeenCalled()
  })

  it('429 after 5 runs in 24 hours', async () => {
    await expect(
      runCustomerLanguage(input, makeDeps({ countRecentRuns: async () => MAX_RUNS_PER_DAY }))
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(extractStructured).not.toHaveBeenCalled()
  })

  it('marks the credential invalid on an auth error', async () => {
    extractStructured.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'bad key', 401))
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 409 })
    expect(markInvalid).toHaveBeenCalledWith('t1', 'anthropic', 'abcd')
    expect(notifyInvalid).toHaveBeenCalled()
    expect(saveInsight).not.toHaveBeenCalled()
  })

  it('maps provider rate limits to 429 and other failures to 502', async () => {
    extractStructured.mockRejectedValueOnce(new LlmProviderError('anthropic', 'rate_limit', 'slow down', 429))
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 429 })
    extractStructured.mockRejectedValueOnce(new LlmProviderError('anthropic', 'server', 'boom', 500))
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 502 })
  })

  it('never puts message text in errors', async () => {
    extractStructured.mockRejectedValue(new LlmProviderError('anthropic', 'server', 'boom', 500))
    const err = await runCustomerLanguage(input, makeDeps()).catch((e) => e)
    expect(JSON.stringify(err.data)).not.toContain('slow exports')
  })
})
