import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  credentials: [] as { provider: string; status: string }[],
  keys: {} as Record<string, { apiKey: string; status: string; monthlyBudgetCents: number | null; keyHint: string }>,
  usage: {} as Record<string, number>,
  extract: vi.fn(),
  recorded: [] as [string, string, number][],
  markInvalid: vi.fn(),
  notify: vi.fn(),
  calledWith: [] as string[],
}))

vi.mock('h3', () => ({
  createError: (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => state.credentials),
  getTeamApiKey: vi.fn(async (_teamId: string, provider: string) => {
    state.calledWith.push(provider)
    return state.keys[provider] ?? null
  }),
  markCredentialInvalid: (...args: unknown[]) => state.markInvalid(...args),
}))

vi.mock('~/server/utils/marketing-usage', () => ({
  getUsage: vi.fn(async () => state.usage),
  recordUsage: vi.fn(async (teamId: string, metric: string, units: number) => {
    state.recorded.push([teamId, metric, units])
  }),
}))

vi.mock('~/server/utils/response', () => ({
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: { CONFLICT: 'CONFLICT', RATE_LIMITED: 'RATE_LIMITED' },
}))

vi.mock('~/server/services/marketing/visibility/runner', () => ({
  budgetExhausted: (usage: Record<string, number>, provider: string, cents: number | null) =>
    cents != null && (usage[`llm:${provider}:cost_usd_micros`] ?? 0) >= cents * 10_000,
  notifyCredentialInvalid: (...args: unknown[]) => state.notify(...args),
}))

vi.mock('~/server/services/llm', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/llm')>('~/server/services/llm')
  return {
    ...actual,
    getLlmProvider: () => ({ extractStructured: (...args: unknown[]) => state.extract(...args) }),
  }
})

const { callTeamLlm } = await import('~/server/services/marketing/llm-call')
const { LlmProviderError } = await import('~/server/services/llm/types')

const request = { system: 's', input: 'i', schema: {}, schemaName: 'n' }
const messages = { noKey: 'no key here', upstream: 'upstream failed' }
const key = (hint = 'abcd', budget: number | null = null) => ({
  apiKey: 'sk-secret',
  status: 'valid',
  monthlyBudgetCents: budget,
  keyHint: hint,
})

beforeEach(() => {
  state.credentials = [{ provider: 'anthropic', status: 'valid' }]
  state.keys = { anthropic: key() }
  state.usage = {}
  state.recorded = []
  state.calledWith = []
  state.markInvalid.mockReset().mockResolvedValue(true)
  state.notify.mockReset().mockResolvedValue(undefined)
  state.extract.mockReset().mockResolvedValue({
    data: { ok: true },
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'claude-haiku-4-5',
  })
})

describe('callTeamLlm', () => {
  it('prefers Anthropic and records token and cost usage', async () => {
    state.credentials = [
      { provider: 'openai', status: 'valid' },
      { provider: 'anthropic', status: 'unchecked' },
    ]
    state.keys.openai = key()
    const result = await callTeamLlm('t1', request, messages)
    expect(result.provider).toBe('anthropic')
    expect(state.calledWith).toEqual(['anthropic'])
    const metrics = state.recorded.map(([, metric]) => metric)
    expect(metrics).toEqual([
      'llm:anthropic:input_tokens',
      'llm:anthropic:output_tokens',
      'llm:anthropic:cost_usd_micros',
    ])
    expect(state.recorded[0][2]).toBe(100)
    expect(state.recorded[1][2]).toBe(50)
  })

  it('falls back to OpenAI when the Anthropic key is invalid', async () => {
    state.credentials = [
      { provider: 'anthropic', status: 'invalid' },
      { provider: 'openai', status: 'valid' },
    ]
    state.keys.openai = key()
    const result = await callTeamLlm('t1', request, messages)
    expect(result.provider).toBe('openai')
  })

  it('409s with the caller message when no key is usable', async () => {
    state.credentials = [{ provider: 'anthropic', status: 'invalid' }]
    await expect(callTeamLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    await expect(callTeamLlm('t1', request, messages)).rejects.toMatchObject({
      data: { error: { message: 'no key here' } },
    })
    expect(state.extract).not.toHaveBeenCalled()
  })

  it('stops at the monthly budget without calling the provider', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:cost_usd_micros': 1_000_000 }
    await expect(callTeamLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.extract).not.toHaveBeenCalled()
    expect(state.recorded).toEqual([])
  })

  it('still calls when usage is below the budget', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:cost_usd_micros': 999_999 }
    await expect(callTeamLlm('t1', request, messages)).resolves.toMatchObject({ data: { ok: true } })
  })

  it('marks the key invalid with its hint on auth errors and maps to 409', async () => {
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'nope', 401))
    await expect(callTeamLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.markInvalid).toHaveBeenCalledWith('t1', 'anthropic', expect.any(String), 'abcd')
    expect(state.notify).toHaveBeenCalledWith('t1', 'anthropic')
  })

  it('does not notify again when the key was already invalid', async () => {
    state.markInvalid.mockResolvedValue(false)
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'nope', 401))
    await expect(callTeamLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.notify).not.toHaveBeenCalled()
  })

  it.each([
    ['quota', 409],
    ['rate_limit', 429],
    ['server', 502],
    ['timeout', 502],
  ] as const)('maps provider %s errors to %i', async (kind, status) => {
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', kind, 'x'))
    const err = await callTeamLlm('t1', request, messages).catch((e) => e)
    expect(err.statusCode).toBe(status)
    expect(state.markInvalid).not.toHaveBeenCalled()
    if (status === 502) expect(err.data.error.message).toBe('upstream failed')
  })

  it('rethrows unknown errors', async () => {
    state.extract.mockRejectedValue(new TypeError('boom'))
    await expect(callTeamLlm('t1', request, messages)).rejects.toThrow('boom')
  })
})
