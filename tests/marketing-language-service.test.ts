import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('h3', () => ({
  createError: (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

const { runCustomerLanguage, MAX_RUNS_PER_DAY } = await import('~/server/services/marketing/customer-language/service')

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

const callLlm = vi.fn<NonNullable<Deps>['callLlm']>()
const claimRun = vi.fn<NonNullable<Deps>['claimRun']>()
const releaseRun = vi.fn(async (_id: string) => undefined)
const completeRun = vi.fn(async (..._args: unknown[]) => undefined)
const collectFeedback = vi.fn<NonNullable<Deps>['collectFeedback']>()
const collectSupport = vi.fn<NonNullable<Deps>['collectSupport']>()

function makeDeps(overrides: Partial<NonNullable<Deps>> = {}): NonNullable<Deps> {
  return {
    readConsent: async () => ({ allowFeedbackText: true, allowSupportText: true }),
    collectFeedback,
    collectSupport,
    listCredentials: async () => [{ provider: 'anthropic', status: 'valid' }],
    countRecentRuns: async () => 0,
    termLabels: async () => ['existing'],
    callLlm,
    claimRun,
    releaseRun,
    completeRun,
    now: () => NOW,
    ...overrides,
  }
}

const sentInput = () => callLlm.mock.calls[0][1].input

function providerError(statusCode: number, reason?: string) {
  return Object.assign(new Error('provider'), { statusCode, data: { error: { details: reason ? { reason } : {} } } })
}

const input = { projectId: 'p1', siteId: 's1', organizationId: 't1', userId: 'u1', productName: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  collectFeedback.mockResolvedValue(items('feedback', 12))
  collectSupport.mockResolvedValue(items('support', 12))
  claimRun.mockResolvedValue('run-1')
  callLlm.mockResolvedValue({
    provider: 'anthropic',
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
    const sent = sentInput()
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
    expect(sentInput()).not.toContain('[feedback]')
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
    expect(callLlm).not.toHaveBeenCalled()
    expect(claimRun).not.toHaveBeenCalled()
  })

  it('re-reads consent on every run (revocation takes effect immediately)', async () => {
    let allowed = true
    const deps = makeDeps({ readConsent: async () => ({ allowFeedbackText: allowed, allowSupportText: false }) })
    await runCustomerLanguage(input, deps)
    allowed = false
    await expect(runCustomerLanguage(input, deps)).rejects.toMatchObject({ statusCode: 409 })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('drops items from a non-consented source even if a collector returned them', async () => {
    collectFeedback.mockResolvedValue([...items('feedback', 12), ...items('support', 5)])
    await runCustomerLanguage(
      input,
      makeDeps({ readConsent: async () => ({ allowFeedbackText: true, allowSupportText: false }) })
    )
    expect(sentInput()).not.toContain('[support]')
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
    expect(callLlm).not.toHaveBeenCalled()
    // window passed to the collector is 90 days before now
    expect(collectFeedback.mock.calls[0][1].getTime()).toBe(daysAgo(90).getTime())
  })

  it('refuses fewer than 10 items without calling the provider', async () => {
    collectFeedback.mockResolvedValue(items('feedback', 9))
    collectSupport.mockResolvedValue([])
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 409 })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('passes product scope to collectors', async () => {
    await runCustomerLanguage(input, makeDeps())
    expect(collectFeedback.mock.calls[0][0]).toBe('p1')
    expect(collectSupport.mock.calls[0].slice(0, 2)).toEqual(['p1', expect.any(Date)])
  })

  it('caps the input at 300 items', async () => {
    collectFeedback.mockResolvedValue(items('feedback', 400).map((i, n) => ({ ...i, text: `${i.text} unique ${n}` })))
    const result = await runCustomerLanguage(input, makeDeps())
    expect(result.itemCount).toBeLessThanOrEqual(300)
  })
})

describe('provider, budget and limits', () => {
  it('stores the insight, filters existing terms and asks callOrgLlm to count the run', async () => {
    const result = await runCustomerLanguage(input, makeDeps())
    expect(result.suggestedTerms).toEqual([{ kind: 'keyword', label: 'slow exports' }])
    expect(completeRun).toHaveBeenCalledTimes(1)
    expect(completeRun.mock.calls[0][0]).toBe('run-1')
    expect(callLlm.mock.calls[0][0]).toBe('t1')
    expect(callLlm.mock.calls[0][1].extraUsageMetrics).toEqual({ 'language:runs': 1 })
  })

  it('409 without a usable key and never reads customer text', async () => {
    await expect(runCustomerLanguage(input, makeDeps({ listCredentials: async () => [] }))).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { details: { reason: 'no_key' } } },
    })
    expect(collectFeedback).not.toHaveBeenCalled()
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('429 after 5 runs in 24 hours', async () => {
    await expect(
      runCustomerLanguage(input, makeDeps({ countRecentRuns: async () => MAX_RUNS_PER_DAY }))
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('429 when the atomic claim loses the race, before the provider is called', async () => {
    claimRun.mockResolvedValue(null)
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({
      statusCode: 429,
      data: { error: { details: { reason: 'daily_limit' } } },
    })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('releases the reservation when the provider was never contacted (budget, no key)', async () => {
    callLlm.mockRejectedValueOnce(providerError(409, 'budget'))
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 409 })
    expect(releaseRun).toHaveBeenCalledWith('run-1')
    callLlm.mockRejectedValueOnce(providerError(409, 'no_key'))
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 409 })
    expect(releaseRun).toHaveBeenCalledTimes(2)
  })

  it('keeps the reservation when the provider was contacted and failed', async () => {
    for (const [status, reason] of [
      [409, 'auth'],
      [409, 'quota'],
      [429, undefined],
      [502, undefined],
    ] as const) {
      callLlm.mockRejectedValueOnce(providerError(status, reason))
      await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: status })
    }
    expect(releaseRun).not.toHaveBeenCalled()
    expect(completeRun).not.toHaveBeenCalled()
  })

  it('502s on unreadable output and keeps the reservation', async () => {
    callLlm.mockResolvedValueOnce({
      provider: 'anthropic',
      data: { nope: 1 },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    await expect(runCustomerLanguage(input, makeDeps())).rejects.toMatchObject({ statusCode: 502 })
    expect(releaseRun).not.toHaveBeenCalled()
  })

  it('never puts message text in errors', async () => {
    callLlm.mockRejectedValue(providerError(502))
    const err = await runCustomerLanguage(input, makeDeps()).catch((e) => e)
    expect(JSON.stringify(err.data)).not.toContain('slow exports')
  })
})

describe('support-derived feedback', () => {
  it('only asks for support-derived feedback with support consent', async () => {
    await runCustomerLanguage(input, makeDeps())
    expect(collectFeedback.mock.calls[0][2]).toEqual({ includeSupportDerived: true })
    collectFeedback.mockClear()
    await runCustomerLanguage(
      input,
      makeDeps({ readConsent: async () => ({ allowFeedbackText: true, allowSupportText: false }) })
    )
    expect(collectFeedback.mock.calls[0][2]).toEqual({ includeSupportDerived: false })
  })
})
