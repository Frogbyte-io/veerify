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
