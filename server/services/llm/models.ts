import type { LlmProviderId } from './types'

/**
 * Default model IDs per provider. Upgrading a model is a one-line change here.
 *
 * - `answer`: the flagship general model consumer chat apps use; this is what
 *   AI-visibility sampling asks questions of (with web search enabled).
 * - `extract`: a small, cheap model for structured extraction.
 *
 * Evidence (checked 2026-10-10):
 * - Anthropic: claude-sonnet-5-5 and claude-haiku-4-5 are current IDs;
 *   haiku-4-5 supports structured outputs
 *   (https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
 * - OpenAI: https://developers.openai.com/api/docs/models lists gpt-6-astra
 *   (flagship), gpt-6.1-sol (near-flagship, cheaper) and gpt-6-luna (cheapest);
 *   Astra and Luna list Web search in their supported tools. The page does not
 *   say which model ChatGPT uses; switch `answer` to `gpt-6.1-sol` to sample
 *   more cheaply.
 */
export const LLM_MODELS: Record<LlmProviderId, { answer: string; extract: string }> = {
  anthropic: { answer: 'claude-sonnet-5-5', extract: 'claude-haiku-4-5' },
  openai: { answer: 'gpt-6-astra', extract: 'gpt-6-luna' },
}

/** Anthropic web search tool version, kept here so bumps are one line. */
export const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20260209'

/**
 * USD per million tokens, standard (non-batch, uncached) rates. Used only to
 * estimate spend against a team's monthly budget cap; the provider's invoice is
 * the real figure. Web-search tool fees (billed per search by both providers,
 * about $10 per 1k searches) are NOT included because adapters do not report
 * search counts, so the estimate under-counts search-heavy usage.
 *
 * Sources, checked 2026-10-10:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   (Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5)
 * - OpenAI: https://developers.openai.com/api/docs/pricing
 *   (gpt-6-astra $10/$50, gpt-6.1-sol $2/$10, gpt-6-luna $0.10/$0.50)
 */
export const LLM_PRICING: Record<LlmProviderId, Record<string, { input: number; output: number }>> = {
  anthropic: {
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-haiku-4-5': { input: 1, output: 5 },
  },
  openai: {
    'gpt-6-astra': { input: 10, output: 50 },
    'gpt-6.1-sol': { input: 2, output: 10 },
    'gpt-6-luna': { input: 0.1, output: 0.5 },
  },
}

/**
 * Estimated cost in micro-USD (1e-6 USD) for one call. Unknown models fall
 * back to the provider's answer-model price (the conservative choice).
 * With prices in USD per million tokens, tokens x price equals micro-USD.
 */
export function estimateCostUsdMicros(
  provider: LlmProviderId,
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number {
  const table = LLM_PRICING[provider]
  const price = table[model] ?? table[LLM_MODELS[provider].answer]
  return Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output)
}
