import { describe, expect, it } from 'vitest'
import { estimateCostUsdMicros, LLM_MODELS, LLM_PRICING } from '~/server/services/llm/models'

describe('estimateCostUsdMicros', () => {
  it('multiplies tokens by USD per million (= micro-USD per token)', () => {
    // sonnet 5.5: $2 in / $10 out per MTok
    expect(
      estimateCostUsdMicros('anthropic', 'claude-sonnet-5-5', null, { inputTokens: 1000, outputTokens: 500 })
    ).toBe(7000)
    // luna: $0.10 / $0.50
    expect(estimateCostUsdMicros('openai', 'gpt-6-luna', null, { inputTokens: 10_000, outputTokens: 2_000 })).toBe(2000)
  })

  it('falls back to the provider answer-model price for unknown models', () => {
    const usage = { inputTokens: 100, outputTokens: 100 }
    expect(estimateCostUsdMicros('openai', 'gpt-future', 'gpt-future', usage)).toBe(
      estimateCostUsdMicros('openai', LLM_MODELS.openai.answer, null, usage)
    )
  })

  it('has a price for every default model', () => {
    for (const provider of Object.keys(LLM_MODELS) as Array<keyof typeof LLM_MODELS>) {
      expect(LLM_PRICING[provider][LLM_MODELS[provider].answer]).toBeDefined()
      expect(LLM_PRICING[provider][LLM_MODELS[provider].extract]).toBeDefined()
    }
  })

  it('is zero for no usage', () => {
    expect(estimateCostUsdMicros('anthropic', 'claude-haiku-4-5', null, { inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  it('prices by the requested model, not the returned id', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 }
    expect(estimateCostUsdMicros('openai', 'gpt-6-luna', 'gpt-6-astra-2026-09-01', usage)).toBe(100_000)
  })

  it('falls back to the longest-prefix match of the returned id', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 }
    expect(estimateCostUsdMicros('openai', 'unlisted', 'gpt-6.1-sol-2026-09-01', usage)).toBe(2_000_000)
    expect(estimateCostUsdMicros('openai', null, 'gpt-6-luna-2026', usage)).toBe(100_000)
  })

  it('adds the per-search fee', () => {
    const usage = { inputTokens: 0, outputTokens: 0, webSearchRequests: 3 }
    expect(estimateCostUsdMicros('anthropic', 'claude-sonnet-5-5', null, usage)).toBe(30_000)
    expect(estimateCostUsdMicros('openai', 'gpt-6-astra', null, usage)).toBe(30_000)
  })
})
