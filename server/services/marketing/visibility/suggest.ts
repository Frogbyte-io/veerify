/**
 * Suggests starter prompts with the team's own LLM key. Only the product name,
 * description and feedback category names are sent; never feedback or support
 * text (design.md, security constraints).
 */

import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt, type ApiCredentialProvider } from '~/server/database/schema/marketing'
import { feedbackCategory } from '~/server/database/schema/feedback'
import { getLlmProvider, LlmProviderError, LLM_MODELS } from '~/server/services/llm'
import { estimateCostUsdMicros } from '~/server/services/llm/models'
import { getTeamApiKey, listTeamCredentials, markCredentialInvalid } from '~/server/utils/team-credentials'
import { getUsage, recordUsage } from '~/server/utils/marketing-usage'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import {
  buildSuggestionInput,
  buildSuggestionSystemPrompt,
  normalizeSuggestions,
  pickSuggestionProvider,
  SUGGESTION_SCHEMA,
} from './prompts'
import { budgetExhausted, notifyCredentialInvalid } from './runner'

function fail(statusCode: number, statusMessage: string, code: string, message: string): never {
  throw createError({ statusCode, statusMessage, data: createErrorResponse(code, message) })
}

export async function suggestPrompts(input: {
  teamId: string
  siteId: string
  project: { id: string; name: string; description: string | null }
}): Promise<{ suggestions: string[]; provider: string }> {
  const credentials = await listTeamCredentials(input.teamId)
  const providerId = pickSuggestionProvider(credentials)
  if (!providerId) {
    fail(409, 'Conflict', ErrorCode.CONFLICT, 'Add a valid Anthropic or OpenAI API key to get suggestions')
  }
  const key = await getTeamApiKey(input.teamId, providerId as ApiCredentialProvider)
  if (!key) fail(409, 'Conflict', ErrorCode.CONFLICT, 'Add a valid Anthropic or OpenAI API key to get suggestions')

  // Same monthly budget guard as the runner
  if (key.monthlyBudgetCents != null) {
    const usage = await getUsage(input.teamId)
    if (budgetExhausted(usage, providerId, key.monthlyBudgetCents)) {
      fail(
        409,
        'Conflict',
        ErrorCode.CONFLICT,
        'The monthly budget for this provider is reached. Raise it in Marketing settings'
      )
    }
  }

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

  try {
    const result = await getLlmProvider(providerId).extractStructured<{ prompts?: unknown }>({
      apiKey: key.apiKey,
      system: buildSuggestionSystemPrompt(),
      input: buildSuggestionInput({
        name: input.project.name,
        description: input.project.description,
        categoryNames: categories.map((c) => c.name),
      }),
      schema: SUGGESTION_SCHEMA,
      schemaName: 'prompt_suggestions',
      model: LLM_MODELS[providerId].extract,
    })

    await Promise.all([
      recordUsage(input.teamId, `llm:${providerId}:input_tokens`, result.usage.inputTokens),
      recordUsage(input.teamId, `llm:${providerId}:output_tokens`, result.usage.outputTokens),
      recordUsage(
        input.teamId,
        `llm:${providerId}:cost_usd_micros`,
        estimateCostUsdMicros(providerId, LLM_MODELS[providerId].extract, result.model, result.usage)
      ),
    ])

    return {
      suggestions: normalizeSuggestions(
        result.data?.prompts,
        existing.map((p) => p.text),
        input.project.name
      ),
      provider: providerId,
    }
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.kind === 'auth') {
        const transitioned = await markCredentialInvalid(
          input.teamId,
          providerId,
          'The provider rejected the API key',
          key.keyHint
        )
        if (transitioned) await notifyCredentialInvalid(input.teamId, providerId).catch(() => undefined)
        fail(409, 'Conflict', ErrorCode.CONFLICT, 'The provider rejected your API key. Update it in Marketing settings')
      }
      if (err.kind === 'quota') {
        fail(
          409,
          'Conflict',
          ErrorCode.CONFLICT,
          'The provider account is out of credit or quota. Add credit and try again'
        )
      }
      if (err.kind === 'rate_limit') {
        fail(
          429,
          'Too Many Requests',
          ErrorCode.RATE_LIMITED,
          'The provider is rate limiting requests. Try again shortly'
        )
      }
      fail(502, 'Bad Gateway', 'UPSTREAM_ERROR', 'The AI provider could not generate suggestions. Try again')
    }
    throw err
  }
}
