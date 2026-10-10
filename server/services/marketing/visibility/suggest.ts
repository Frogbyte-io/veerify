/**
 * Suggests starter prompts with the team's own LLM key. Only the product name,
 * description and feedback category names are sent; never feedback or support
 * text (design.md, security constraints).
 */

import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt } from '~/server/database/schema/marketing'
import { feedbackCategory } from '~/server/database/schema/feedback'
import { callTeamLlm } from '~/server/services/marketing/llm-call'
import { buildSuggestionInput, buildSuggestionSystemPrompt, normalizeSuggestions, SUGGESTION_SCHEMA } from './prompts'

export async function suggestPrompts(input: {
  teamId: string
  siteId: string
  project: { id: string; name: string; description: string | null }
}): Promise<{ suggestions: string[]; provider: string }> {
  const [categories, existing] = await Promise.all([
    db
      .select({ name: feedbackCategory.name })
      .from(feedbackCategory)
      .where(eq(feedbackCategory.projectId, input.project.id)),
    db
      .select({ text: aiVisibilityPrompt.text })
      .from(aiVisibilityPrompt)
      .where(eq(aiVisibilityPrompt.siteId, input.siteId)),
  ])

  const result = await callTeamLlm<{ prompts?: unknown }>(
    input.teamId,
    {
      system: buildSuggestionSystemPrompt(),
      input: buildSuggestionInput({
        name: input.project.name,
        description: input.project.description,
        categoryNames: categories.map((c) => c.name),
      }),
      schema: SUGGESTION_SCHEMA,
      schemaName: 'prompt_suggestions',
    },
    {
      noKey: 'Add a valid Anthropic or OpenAI API key to get suggestions',
      upstream: 'The AI provider could not generate suggestions. Try again',
    }
  )

  return {
    suggestions: normalizeSuggestions(
      result.data?.prompts,
      existing.map((p) => p.text),
      input.project.name
    ),
    provider: result.provider,
  }
}
