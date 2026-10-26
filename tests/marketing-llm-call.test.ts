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
  budgetCalls: [] as string[],
  workspaceCapCents: null as number | null,
}))

vi.mock('h3', () => ({
  createError: (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

vi.mock('~/server/utils/org-credentials', () => ({
  listOrgCredentials: vi.fn(async () => state.credentials),
  getOrgApiKey: vi.fn(async (_teamId: string, provider: string) => {
    state.calledWith.push(provider)
    return state.keys[provider] ?? null
  }),
  markCredentialInvalid: (...args: unknown[]) => state.markInvalid(...args),
}))

vi.mock('~/server/utils/marketing-usage', () => ({
  recordUsage: vi.fn(async (teamId: string, metric: string, units: number) => {
    state.recorded.push([teamId, metric, units])
  }),
}))

vi.mock('~/server/utils/response', () => ({
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  }),
  ErrorCode: { CONFLICT: 'CONFLICT', RATE_LIMITED: 'RATE_LIMITED' },
}))

// In-memory store honouring the same guard as the SQL: spent + reserved + amount <= cap
vi.mock('~/server/services/marketing/llm-budget', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/marketing/llm-budget')>(
    '~/server/services/marketing/llm-budget'
  )
  const reserveBudget = vi.fn(async (_t: string, provider: string, amount: number, cap: number | null) => {
    state.budgetCalls.push(`reserve:${amount}`)
    if (cap == null) return true
    const reservedKey = `llm:${provider}:reserved_usd_micros`
    const spent = state.usage[`llm:${provider}:cost_usd_micros`] ?? 0
    const reserved = state.usage[reservedKey] ?? 0
    if (!actual.fitsBudget(spent, reserved, amount, cap)) return false
    state.usage[reservedKey] = reserved + amount
    return true
  })
  const settleBudget = vi.fn(async (_t: string, provider: string, held: number, cost: number) => {
    state.budgetCalls.push(`settle:${held}:${cost}`)
    const reservedKey = `llm:${provider}:reserved_usd_micros`
    state.usage[reservedKey] = Math.max(0, (state.usage[reservedKey] ?? 0) - held)
    state.usage[`llm:${provider}:cost_usd_micros`] = (state.usage[`llm:${provider}:cost_usd_micros`] ?? 0) + cost
  })
  const releaseBudget = vi.fn(async (_t: string, provider: string, held: number) => {
    state.budgetCalls.push(`release:${held}`)
    const reservedKey = `llm:${provider}:reserved_usd_micros`
    state.usage[reservedKey] = Math.max(0, (state.usage[reservedKey] ?? 0) - held)
  })
  // Workspace cap over the same in-memory store: settled spend across providers + reserved + amount <= cap
  const workspaceSpent = () =>
    Object.entries(state.usage)
      .filter(([metric]) => /^llm:[^:]+:cost_usd_micros$/.test(metric))
      .reduce((sum, [, units]) => sum + units, 0)
  return {
    ...actual,
    reserveBudget,
    settleBudget,
    releaseBudget,
    reserveCallBudget: vi.fn(async (t: string, provider: string, amount: number, cap: number | null) => {
      const hold = {
        providerMicros: actual.heldMicros(amount, cap),
        workspaceMicros: actual.heldMicros(amount, state.workspaceCapCents),
      }
      if (!(await reserveBudget(t, provider, hold.providerMicros, cap))) {
        return { ok: false as const, scope: 'provider' as const, reason: 'cap' as const }
      }
      if (state.workspaceCapCents != null) {
        const reserved = state.usage['llm:all:reserved_usd_micros'] ?? 0
        if (!actual.fitsBudget(workspaceSpent(), reserved, hold.workspaceMicros, state.workspaceCapCents)) {
          await releaseBudget(t, provider, hold.providerMicros)
          return { ok: false as const, scope: 'workspace' as const, reason: 'cap' as const }
        }
        state.usage['llm:all:reserved_usd_micros'] = reserved + hold.workspaceMicros
      }
      return { ok: true as const, hold }
    }),
    settleCallBudget: vi.fn(
      async (t: string, provider: string, hold: { providerMicros: number; workspaceMicros: number }, cost: number) => {
        await settleBudget(t, provider, hold.providerMicros, cost)
        state.usage['llm:all:reserved_usd_micros'] = Math.max(
          0,
          (state.usage['llm:all:reserved_usd_micros'] ?? 0) - hold.workspaceMicros
        )
      }
    ),
    releaseCallBudget: vi.fn(
      async (t: string, provider: string, hold: { providerMicros: number; workspaceMicros: number }) => {
        await releaseBudget(t, provider, hold.providerMicros)
        state.usage['llm:all:reserved_usd_micros'] = Math.max(
          0,
          (state.usage['llm:all:reserved_usd_micros'] ?? 0) - hold.workspaceMicros
        )
      }
    ),
  }
})

vi.mock('~/server/services/marketing/visibility/runner', () => ({
  notifyCredentialInvalid: (...args: unknown[]) => state.notify(...args),
}))

vi.mock('~/server/services/llm', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/llm')>('~/server/services/llm')
  return {
    ...actual,
    getLlmProvider: () => ({ extractStructured: (...args: unknown[]) => state.extract(...args) }),
  }
})

const { callOrgLlm } = await import('~/server/services/marketing/llm-call')
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
  state.budgetCalls = []
  state.workspaceCapCents = null
  state.markInvalid.mockReset().mockResolvedValue(true)
  state.notify.mockReset().mockResolvedValue(undefined)
  state.extract.mockReset().mockResolvedValue({
    data: { ok: true },
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'claude-haiku-4-5',
  })
})

describe('callOrgLlm', () => {
  it('prefers Anthropic and records token and cost usage', async () => {
    state.credentials = [
      { provider: 'openai', status: 'valid' },
      { provider: 'anthropic', status: 'unchecked' },
    ]
    state.keys.openai = key()
    const result = await callOrgLlm('t1', request, messages)
    expect(result.provider).toBe('anthropic')
    expect(state.calledWith).toEqual(['anthropic'])
    const metrics = state.recorded.map(([, metric]) => metric)
    // cost is booked by settleBudget, not recordUsage
    expect(metrics).toEqual(['llm:anthropic:input_tokens', 'llm:anthropic:output_tokens'])
    expect(state.recorded[0][2]).toBe(100)
    expect(state.recorded[1][2]).toBe(50)
  })

  it('falls back to OpenAI when the Anthropic key is invalid', async () => {
    state.credentials = [
      { provider: 'anthropic', status: 'invalid' },
      { provider: 'openai', status: 'valid' },
    ]
    state.keys.openai = key()
    const result = await callOrgLlm('t1', request, messages)
    expect(result.provider).toBe('openai')
  })

  it('409s with the caller message when no key is usable', async () => {
    state.credentials = [{ provider: 'anthropic', status: 'invalid' }]
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({
      data: { error: { message: 'no key here' } },
    })
    expect(state.extract).not.toHaveBeenCalled()
  })

  it('stops at the monthly budget without calling the provider', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:cost_usd_micros': 1_000_000 }
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.extract).not.toHaveBeenCalled()
    expect(state.recorded).toEqual([])
  })

  it('stops at the workspace spend cap, counting spend on every provider, without calling', async () => {
    state.keys.anthropic = key('abcd', null)
    state.workspaceCapCents = 100
    // Spend on another provider counts towards the workspace cap
    state.usage = { 'llm:openai:cost_usd_micros': 1_000_000 }
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { message: expect.stringMatching(/workspace AI spend cap/) } },
    })
    expect(state.extract).not.toHaveBeenCalled()
    expect(state.usage['llm:anthropic:reserved_usd_micros'] ?? 0).toBe(0)
  })

  it('holds and then frees a workspace reservation when only the workspace is capped', async () => {
    state.keys.anthropic = key('abcd', null)
    state.workspaceCapCents = 100
    await expect(callOrgLlm('t1', request, messages)).resolves.toMatchObject({ data: { ok: true } })
    expect(state.usage['llm:all:reserved_usd_micros']).toBe(0)
    expect(state.usage['llm:anthropic:cost_usd_micros']).toBeGreaterThan(0)
  })

  it('still calls when the reservation fits under the budget', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:cost_usd_micros': 900_000 }
    await expect(callOrgLlm('t1', request, messages)).resolves.toMatchObject({ data: { ok: true } })
  })

  it('counts in-flight reservations against the budget', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:reserved_usd_micros': 990_000 }
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.extract).not.toHaveBeenCalled()
  })

  it('reserves before the call and settles the actual cost (haiku 100*1 + 50*5)', async () => {
    state.keys.anthropic = key('abcd', 100)
    await callOrgLlm('t1', request, messages)
    const [reserve, settle] = state.budgetCalls
    expect(reserve).toMatch(/^reserve:\d+$/)
    const held = Number(reserve.split(':')[1])
    expect(held).toBeGreaterThan(350)
    expect(settle).toBe(`settle:${held}:350`)
    expect(state.usage['llm:anthropic:reserved_usd_micros']).toBe(0)
    expect(state.usage['llm:anthropic:cost_usd_micros']).toBe(350)
  })

  it('holds nothing for a key without a cap but still books the cost', async () => {
    await callOrgLlm('t1', request, messages)
    expect(state.budgetCalls).toEqual(['reserve:0', 'settle:0:350'])
  })

  it('releases the reservation when the provider fails', async () => {
    state.keys.anthropic = key('abcd', 100)
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'server', 'x'))
    await callOrgLlm('t1', request, messages).catch(() => undefined)
    expect(state.budgetCalls[1]).toMatch(/^release:\d+$/)
    expect(state.usage['llm:anthropic:reserved_usd_micros']).toBe(0)
    expect(state.usage['llm:anthropic:cost_usd_micros'] ?? 0).toBe(0)
  })

  it('marks the key invalid with its hint on auth errors and maps to 409', async () => {
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'nope', 401))
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.markInvalid).toHaveBeenCalledWith('t1', 'anthropic', expect.any(String), 'abcd')
    expect(state.notify).toHaveBeenCalledWith('t1', 'anthropic')
  })

  it('does not notify again when the key was already invalid', async () => {
    state.markInvalid.mockResolvedValue(false)
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'nope', 401))
    await expect(callOrgLlm('t1', request, messages)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.notify).not.toHaveBeenCalled()
  })

  it.each([
    ['quota', 409],
    ['rate_limit', 429],
    ['server', 502],
    ['timeout', 502],
  ] as const)('maps provider %s errors to %i', async (kind, status) => {
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', kind, 'x'))
    const err = await callOrgLlm('t1', request, messages).catch((e) => e)
    expect(err.statusCode).toBe(status)
    expect(state.markInvalid).not.toHaveBeenCalled()
    if (status === 502) expect(err.data.error.message).toBe('upstream failed')
  })

  it('rethrows unknown errors', async () => {
    state.extract.mockRejectedValue(new TypeError('boom'))
    await expect(callOrgLlm('t1', request, messages)).rejects.toThrow('boom')
  })

  it('records extra usage metrics only after a successful call', async () => {
    await callOrgLlm('t1', { ...request, extraUsageMetrics: { 'language:runs': 1 } }, messages)
    expect(state.recorded.map(([, metric, units]) => [metric, units])).toContainEqual(['language:runs', 1])

    state.recorded = []
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'server', 'x'))
    await callOrgLlm('t1', { ...request, extraUsageMetrics: { 'language:runs': 1 } }, messages).catch(() => undefined)
    expect(state.recorded).toEqual([])
  })

  it('tags 409 failures with a machine-readable reason', async () => {
    const reasonOf = async () => (await callOrgLlm('t1', request, messages).catch((e) => e)).data.error.details?.reason

    state.credentials = []
    expect(await reasonOf()).toBe('no_key')

    state.credentials = [{ provider: 'anthropic', status: 'valid' }]
    state.keys.anthropic = key('abcd', 100)
    state.usage = { 'llm:anthropic:cost_usd_micros': 1_000_000 }
    expect(await reasonOf()).toBe('budget')

    state.keys.anthropic = key()
    state.usage = {}
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'auth', 'x', 401))
    expect(await reasonOf()).toBe('auth')
    state.extract.mockRejectedValue(new LlmProviderError('anthropic', 'quota', 'x'))
    expect(await reasonOf()).toBe('quota')
  })
})
