/**
 * One-off structured LLM call with the team's own key (bring your own key).
 * Shared by the features that call the model outside the scheduled runner:
 * prompt suggestions, announcement drafts and customer language analysis.
 *
 * Handles key selection (Anthropic first, then OpenAI, Gemini, Perplexity), the monthly budget
 * guard, usage recording and the mapping of provider failures to HTTP errors.
 */

import { createError } from 'h3'
import { getLlmProvider, LlmProviderError, LLM_MODELS, type LlmProviderId } from '~/server/services/llm'
import { estimateCostUsdMicros } from '~/server/services/llm/models'
import type { ApiCredentialProvider } from '~/server/database/schema/marketing'
import { getTeamApiKey, listTeamCredentials, markCredentialInvalid } from '~/server/utils/team-credentials'
import { getUsage, recordUsage } from '~/server/utils/marketing-usage'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { budgetExhausted, notifyCredentialInvalid } from './visibility/runner'
import { pickSuggestionProvider } from './visibility/prompts'

/** Why a call was refused or failed; sent as `error.details.reason` on 409s. */
export type TeamLlmFailureReason = 'budget' | 'no_key' | 'quota' | 'auth'

export function failWith(
  statusCode: number,
  statusMessage: string,
  code: string,
  message: string,
  reason?: string
): never {
  throw createError({
    statusCode,
    statusMessage,
    data: createErrorResponse(code, message, reason ? { reason } : undefined),
  })
}

/** True when a failure from `callTeamLlm` happened before the provider was contacted. */
export function failedBeforeProviderCall(error: unknown): boolean {
  const reason = (error as { data?: { error?: { details?: { reason?: string } } } })?.data?.error?.details?.reason
  return reason === 'no_key' || reason === 'budget'
}

export interface TeamLlmRequest {
  system: string
  input: string
  schema: Record<string, unknown>
  schemaName: string
  /** Extra usage counters recorded only after a successful call, e.g. `{ 'language:runs': 1 }` */
  extraUsageMetrics?: Record<string, number>
}

export interface TeamLlmMessages {
  /** 409 when the team has no usable key */
  noKey: string
  /** 502 for provider failures that are not auth, quota or rate limit */
  upstream: string
}

export interface TeamLlmResult<T> {
  data: T
  provider: LlmProviderId
  /** Model the provider reports it used */
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

export async function callTeamLlm<T>(
  teamId: string,
  request: TeamLlmRequest,
  messages: TeamLlmMessages
): Promise<TeamLlmResult<T>> {
  const credentials = await listTeamCredentials(teamId)
  const providerId = pickSuggestionProvider(credentials)
  if (!providerId) failWith(409, 'Conflict', ErrorCode.CONFLICT, messages.noKey, 'no_key')
  const key = await getTeamApiKey(teamId, providerId as ApiCredentialProvider)
  if (!key) failWith(409, 'Conflict', ErrorCode.CONFLICT, messages.noKey, 'no_key')

  // Same monthly budget guard as the runner
  if (key.monthlyBudgetCents != null) {
    const usage = await getUsage(teamId)
    if (budgetExhausted(usage, providerId, key.monthlyBudgetCents)) {
      failWith(
        409,
        'Conflict',
        ErrorCode.CONFLICT,
        'The monthly budget for this provider is reached. Raise it in Marketing settings',
        'budget'
      )
    }
  }

  try {
    const result = await getLlmProvider(providerId).extractStructured<T>({
      apiKey: key.apiKey,
      system: request.system,
      input: request.input,
      schema: request.schema,
      schemaName: request.schemaName,
      model: LLM_MODELS[providerId].extract,
    })

    await Promise.all([
      recordUsage(teamId, `llm:${providerId}:input_tokens`, result.usage.inputTokens),
      recordUsage(teamId, `llm:${providerId}:output_tokens`, result.usage.outputTokens),
      recordUsage(
        teamId,
        `llm:${providerId}:cost_usd_micros`,
        estimateCostUsdMicros(providerId, LLM_MODELS[providerId].extract, result.model, result.usage)
      ),
      ...Object.entries(request.extraUsageMetrics ?? {}).map(([metric, units]) => recordUsage(teamId, metric, units)),
    ])

    return { data: result.data, provider: providerId, model: result.model, usage: result.usage }
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.kind === 'auth') {
        const transitioned = await markCredentialInvalid(
          teamId,
          providerId,
          'The provider rejected the API key',
          key.keyHint
        )
        if (transitioned) await notifyCredentialInvalid(teamId, providerId).catch(() => undefined)
        failWith(
          409,
          'Conflict',
          ErrorCode.CONFLICT,
          'The provider rejected your API key. Update it in Marketing settings',
          'auth'
        )
      }
      if (err.kind === 'quota') {
        failWith(
          409,
          'Conflict',
          ErrorCode.CONFLICT,
          'The provider account is out of credit or quota. Add credit and try again',
          'quota'
        )
      }
      if (err.kind === 'rate_limit') {
        failWith(
          429,
          'Too Many Requests',
          ErrorCode.RATE_LIMITED,
          'The provider is rate limiting requests. Try again shortly'
        )
      }
      failWith(502, 'Bad Gateway', 'UPSTREAM_ERROR', messages.upstream)
    }
    throw err
  }
}
