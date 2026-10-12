/** Prompt validation and LLM-suggested prompts for AI visibility. */

import { z } from 'zod'
import type { LlmProviderId } from '~/server/services/llm/types'

export const PROMPT_MIN_LENGTH = 10
export const PROMPT_MAX_LENGTH = 300
export const MAX_ACTIVE_PROMPTS = 25
/** Active + inactive prompts per site */
export const MAX_TOTAL_PROMPTS = 100
export const SUGGESTION_COUNT = 8

export const promptTextSchema = z
  .string()
  .trim()
  .min(PROMPT_MIN_LENGTH, `Prompt must be at least ${PROMPT_MIN_LENGTH} characters`)
  .max(PROMPT_MAX_LENGTH, `Prompt must be ${PROMPT_MAX_LENGTH} characters or fewer`)

/** Order in which a team's keys are tried for suggestions: Anthropic first, then OpenAI. */
export function pickSuggestionProvider(credentials: { provider: string; status: string }[]): LlmProviderId | null {
  for (const id of ['anthropic', 'openai'] as const) {
    if (credentials.some((c) => c.provider === id && c.status !== 'invalid')) return id
  }
  return null
}

export const SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Questions a potential customer might ask an AI assistant',
    },
  },
  required: ['prompts'],
  additionalProperties: false,
}

export interface SuggestionInput {
  name: string
  description: string | null
  categoryNames: string[]
}

export function buildSuggestionSystemPrompt(): string {
  return `You help a software team measure whether AI assistants recommend their product.
Given a product name, description and the names of its feedback categories, write ${SUGGESTION_COUNT} questions that a potential customer might ask an AI assistant when looking for a tool that solves the problem this product solves.
Rules:
- Questions are generic and category-level (for example "What is the best tool for collecting user feedback for a small SaaS?").
- Never include the product's own name.
- Each question is between ${PROMPT_MIN_LENGTH} and ${PROMPT_MAX_LENGTH} characters.
- Vary the phrasing: recommendations, comparisons, "alternatives to" and how-to questions.
Return a JSON object with a "prompts" array of strings.`
}

/** The only product facts sent to the provider: name, description and category names. */
export function buildSuggestionInput(input: SuggestionInput): string {
  const lines = [`Product name: ${input.name}`]
  if (input.description?.trim()) lines.push(`Description: ${input.description.trim().slice(0, 1000)}`)
  if (input.categoryNames.length > 0) lines.push(`Feedback categories: ${input.categoryNames.join(', ')}`)
  return lines.join('\n')
}

/** Cleans model output: valid length, de-duplicated (also against existing prompts), capped. */
export function normalizeSuggestions(raw: unknown, existing: string[], productName?: string): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set(existing.map((t) => t.trim().toLowerCase()))
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text.length < PROMPT_MIN_LENGTH || text.length > PROMPT_MAX_LENGTH) continue
    if (productName && text.toLowerCase().includes(productName.toLowerCase())) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= SUGGESTION_COUNT) break
  }
  return out
}
