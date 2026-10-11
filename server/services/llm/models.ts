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
 * - Perplexity (checked 2026-10-10): Sonar Chat Completions support ended
 *   2026-09-27; the Agent API (POST /v1/agent) replaces it
 *   (https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md).
 *   Model IDs are `creator/name` (https://docs.perplexity.ai/docs/agent-api/models.md);
 *   `perplexity/sonar` is Perplexity's own search model, used for answers and extraction.
 * - Gemini (checked 2026-10-10): https://ai.google.dev/gemini-api/docs/models lists
 *   gemini-3.8-flash as the stable flagship and gemini-3.1-flash-lite /
 *   gemini-3.5-flash-lite as the budget stable models (Pro is still preview).
 *   Extraction uses the cheaper one per the pricing page, gemini-3.1-flash-lite.
 */
export const LLM_MODELS: Record<LlmProviderId, { answer: string; extract: string }> = {
  anthropic: { answer: 'claude-sonnet-5-5', extract: 'claude-haiku-4-5' },
  openai: { answer: 'gpt-6-astra', extract: 'gpt-6-luna' },
  perplexity: { answer: 'perplexity/sonar', extract: 'perplexity/sonar' },
  gemini: { answer: 'gemini-3.8-flash', extract: 'gemini-3.1-flash-lite' },
}

/** Anthropic web search tool version, kept here so bumps are one line. */
export const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20260209'

/**
 * USD per million tokens, standard (non-batch, uncached) rates, plus the fee per
 * web search call in micro-USD. Used only to estimate spend against a team's
 * monthly budget cap; the provider's invoice is the real figure.
 *
 * Sources, checked 2026-10-10:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   (Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5); web search $10 per 1,000 searches
 *   (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
 * - OpenAI: https://developers.openai.com/api/docs/pricing
 *   (gpt-6-astra $10/$50, gpt-6.1-sol $2/$10, gpt-6-luna $0.10/$0.50);
 *   web search tool calls $10 per 1,000 calls
 * - Perplexity: https://docs.perplexity.ai/docs/agent-api/models.md (perplexity/sonar
 *   $0.25/$2.50, low tier) and https://docs.perplexity.ai/docs/getting-started/pricing.md
 *   (Agent API web search $0.0025 per invocation)
 * - Gemini: https://ai.google.dev/gemini-api/docs/pricing (gemini-3.8-flash $0.75/$3.75,
 *   gemini-3.1-flash-lite $0.25/$1.50; Grounding with Google Search $14 per 1,000
 *   search queries on Gemini 3+; the 5,000 free monthly searches are ignored, so the
 *   estimate is conservative)
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
  perplexity: {
    'perplexity/sonar': { input: 0.25, output: 2.5 },
  },
  gemini: {
    'gemini-3.8-flash': { input: 0.75, output: 3.75 },
    'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  },
}

/** Micro-USD per web search call (Anthropic/OpenAI $10 per 1,000, Perplexity $2.50, Gemini $14). */
export const LLM_WEB_SEARCH_FEE_MICROS: Record<LlmProviderId, number> = {
  anthropic: 10_000,
  openai: 10_000,
  perplexity: 2_500,
  gemini: 14_000,
}

/**
 * Estimated cost in micro-USD (1e-6 USD) for one call. Price lookup order:
 * the requested model, the longest table key that prefixes the returned model
 * id (e.g. dated snapshots), then the provider's answer-model price (the
 * conservative choice). With prices in USD per million tokens, tokens x price
 * equals micro-USD. Web search calls add the provider's per-search fee.
 */
export function estimateCostUsdMicros(
  provider: LlmProviderId,
  requestedModel: string | null | undefined,
  returnedModel: string | null | undefined,
  usage: { inputTokens: number; outputTokens: number; webSearchRequests?: number }
): number {
  const table = LLM_PRICING[provider]
  let price = requestedModel ? table[requestedModel] : undefined
  if (!price && returnedModel) {
    const key = Object.keys(table)
      .filter((k) => returnedModel.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    if (key) price = table[key]
  }
  price ??= table[LLM_MODELS[provider].answer]
  const search = (usage.webSearchRequests ?? 0) * LLM_WEB_SEARCH_FEE_MICROS[provider]
  return Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output + search)
}

/**
 * Per-call caps the adapters enforce (or, where the provider has no hard cap, the figure budget
 * reservations assume). Adapters import these so reservations and real requests cannot drift.
 * - `answerMaxOutputTokens` / `extractMaxOutputTokens`: request output cap. OpenAI sets none, so
 *   4096 is an assumption for reservations only.
 * - `maxSearches`: web searches per answer call. Anthropic (`max_uses`) and OpenAI
 *   (`max_tool_calls`) cap it; Gemini and Perplexity do not, so 5 is an assumption.
 */
export const LLM_CALL_LIMITS: Record<
  LlmProviderId,
  { answerMaxOutputTokens: number; extractMaxOutputTokens: number; maxSearches: number }
> = {
  anthropic: { answerMaxOutputTokens: 4096, extractMaxOutputTokens: 4096, maxSearches: 5 },
  openai: { answerMaxOutputTokens: 4096, extractMaxOutputTokens: 4096, maxSearches: 5 },
  perplexity: { answerMaxOutputTokens: 2048, extractMaxOutputTokens: 1024, maxSearches: 5 },
  gemini: { answerMaxOutputTokens: 4096, extractMaxOutputTokens: 2048, maxSearches: 5 },
}
