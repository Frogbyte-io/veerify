/**
 * Customer language runs. Privacy rule (design.md, security constraints): no
 * feedback or support text reaches an LLM provider unless the team has an
 * explicit consent for that source, re-read at run time. Message text is never
 * logged.
 */

import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, notInArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  customerLanguageInsight,
  marketingDataConsent,
  marketingTerm,
  type ApiCredentialProvider,
} from '~/server/database/schema/marketing'
import {
  getLlmProvider,
  LlmProviderError,
  LLM_MODELS,
  type LlmProvider,
  type LlmProviderId,
} from '~/server/services/llm'
import { estimateCostUsdMicros } from '~/server/services/llm/models'
import { pickSuggestionProvider } from '~/server/services/marketing/visibility/prompts'
import { budgetExhausted, notifyCredentialInvalid } from '~/server/services/marketing/visibility/runner'
import { getTeamApiKey, listTeamCredentials, markCredentialInvalid } from '~/server/utils/team-credentials'
import { getUsage, recordUsage } from '~/server/utils/marketing-usage'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { collectFeedbackItems, collectSupportItems, languageWindowStart, type DatedItem } from './collect'
import {
  buildLanguageSystemPrompt,
  GenerationOutputError,
  LANGUAGE_SCHEMA,
  parseLanguageOutput,
  prepareLanguageInput,
  type LanguageResult,
} from './prompt'

export const MIN_LANGUAGE_ITEMS = 10
export const MAX_RUNS_PER_DAY = 5
export const KEEP_INSIGHTS = 10

export type LanguageSource = 'feedback' | 'support'
export type LanguageBlockReason = 'no_consent' | 'no_key' | 'daily_limit'

export interface DataConsent {
  allowFeedbackText: boolean
  allowSupportText: boolean
}

function fail(statusCode: number, statusMessage: string, code: string, message: string, reason?: string): never {
  throw createError({
    statusCode,
    statusMessage,
    data: createErrorResponse(code, message, reason ? { reason } : undefined),
  })
}

export function consentedSources(consent: DataConsent): LanguageSource[] {
  const sources: LanguageSource[] = []
  if (consent.allowFeedbackText) sources.push('feedback')
  if (consent.allowSupportText) sources.push('support')
  return sources
}

export async function readConsent(teamId: string): Promise<DataConsent> {
  const [row] = await db
    .select({
      allowFeedbackText: marketingDataConsent.allowFeedbackText,
      allowSupportText: marketingDataConsent.allowSupportText,
    })
    .from(marketingDataConsent)
    .where(eq(marketingDataConsent.teamId, teamId))
    .limit(1)
  return { allowFeedbackText: row?.allowFeedbackText === true, allowSupportText: row?.allowSupportText === true }
}

export async function countRecentRuns(siteId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [row] = await db
    .select({ n: count() })
    .from(customerLanguageInsight)
    .where(and(eq(customerLanguageInsight.siteId, siteId), gte(customerLanguageInsight.createdAt, since)))
  return Number(row?.n ?? 0)
}

/** Why a run cannot start right now, or null. Cheap checks only; item count is checked at run time. */
export async function languageBlockReason(input: {
  teamId: string
  siteId: string
}): Promise<{ reason: LanguageBlockReason; message: string } | null> {
  const consent = await readConsent(input.teamId)
  if (consentedSources(consent).length === 0) {
    return {
      reason: 'no_consent',
      message: 'Allow Veerify to send feedback or support text to your AI provider first',
    }
  }
  const credentials = await listTeamCredentials(input.teamId)
  if (!pickSuggestionProvider(credentials)) {
    return { reason: 'no_key', message: 'Add a valid Anthropic or OpenAI API key in Marketing settings' }
  }
  if ((await countRecentRuns(input.siteId)) >= MAX_RUNS_PER_DAY) {
    return { reason: 'daily_limit', message: `At most ${MAX_RUNS_PER_DAY} analyses per product per day` }
  }
  return null
}

export interface LanguageRunDeps {
  readConsent(teamId: string): Promise<DataConsent>
  collectFeedback(projectId: string, since: Date): Promise<DatedItem[]>
  collectSupport(teamId: string, projectId: string, since: Date): Promise<DatedItem[]>
  listCredentials(teamId: string): Promise<{ provider: string; status: string }[]>
  getKey(
    teamId: string,
    provider: ApiCredentialProvider
  ): Promise<{ apiKey: string; keyHint: string; monthlyBudgetCents: number | null } | null>
  getUsage(teamId: string): Promise<Record<string, number>>
  countRecentRuns(siteId: string): Promise<number>
  termLabels(siteId: string): Promise<string[]>
  getProvider(id: LlmProviderId): LlmProvider
  record(teamId: string, metric: string, units: number): Promise<void>
  saveInsight(row: typeof customerLanguageInsight.$inferInsert): Promise<void>
  markInvalid(teamId: string, provider: LlmProviderId, keyHint: string): Promise<boolean>
  notifyInvalid(teamId: string, provider: LlmProviderId): Promise<void>
  now(): Date
}

const defaultDeps: LanguageRunDeps = {
  readConsent,
  collectFeedback: collectFeedbackItems,
  collectSupport: collectSupportItems,
  listCredentials: listTeamCredentials,
  getKey: getTeamApiKey,
  getUsage,
  countRecentRuns,
  async termLabels(siteId) {
    const rows = await db
      .select({ label: marketingTerm.label })
      .from(marketingTerm)
      .where(eq(marketingTerm.siteId, siteId))
    return rows.map((r) => r.label)
  },
  getProvider: getLlmProvider,
  record: recordUsage,
  async saveInsight(row) {
    await db.insert(customerLanguageInsight).values(row)
    // Keep the newest KEEP_INSIGHTS per site
    const keep = await db
      .select({ id: customerLanguageInsight.id })
      .from(customerLanguageInsight)
      .where(eq(customerLanguageInsight.siteId, row.siteId))
      .orderBy(desc(customerLanguageInsight.createdAt))
      .limit(KEEP_INSIGHTS)
    await db.delete(customerLanguageInsight).where(
      and(
        eq(customerLanguageInsight.siteId, row.siteId),
        notInArray(
          customerLanguageInsight.id,
          keep.map((k) => k.id)
        )
      )
    )
  },
  markInvalid: (teamId, provider, keyHint) =>
    markCredentialInvalid(teamId, provider, 'The provider rejected the API key', keyHint),
  notifyInvalid: notifyCredentialInvalid,
  now: () => new Date(),
}

export interface LanguageRunInput {
  projectId: string
  siteId: string
  teamId: string
  userId: string
  /** Used only to tell the model not to echo the product name; no customer data */
  productName?: string
}

export async function runCustomerLanguage(
  input: LanguageRunInput,
  deps: LanguageRunDeps = defaultDeps
): Promise<{ id: string; provider: LlmProviderId; itemCount: number; sources: LanguageSource[] } & LanguageResult> {
  // 1. Consent, re-read now. Nothing is collected from a source without it.
  const consent = await deps.readConsent(input.teamId)
  const sources = consentedSources(consent)
  if (sources.length === 0) {
    fail(
      409,
      'Conflict',
      ErrorCode.CONFLICT,
      'Allow Veerify to send feedback or support text to your AI provider before running an analysis',
      'no_consent'
    )
  }

  // 2. Cheap guards before reading any customer text
  const credentials = await deps.listCredentials(input.teamId)
  const providerId = pickSuggestionProvider(credentials)
  if (!providerId) {
    fail(409, 'Conflict', ErrorCode.CONFLICT, 'Add a valid Anthropic or OpenAI API key to run an analysis', 'no_key')
  }
  const key = await deps.getKey(input.teamId, providerId)
  if (!key)
    fail(409, 'Conflict', ErrorCode.CONFLICT, 'Add a valid Anthropic or OpenAI API key to run an analysis', 'no_key')

  if (key.monthlyBudgetCents != null) {
    const usage = await deps.getUsage(input.teamId)
    if (budgetExhausted(usage, providerId, key.monthlyBudgetCents)) {
      fail(
        409,
        'Conflict',
        ErrorCode.CONFLICT,
        'The monthly budget for this provider is reached. Raise it in Marketing settings',
        'budget'
      )
    }
  }

  if ((await deps.countRecentRuns(input.siteId)) >= MAX_RUNS_PER_DAY) {
    fail(
      429,
      'Too Many Requests',
      ErrorCode.RATE_LIMITED,
      `You can run at most ${MAX_RUNS_PER_DAY} analyses per product per day`,
      'daily_limit'
    )
  }

  // 3. Collect from consented sources only, for this product, in the window
  const now = deps.now()
  const since = languageWindowStart(now)
  const collected: DatedItem[] = []
  if (consent.allowFeedbackText) collected.push(...(await deps.collectFeedback(input.projectId, since)))
  if (consent.allowSupportText) collected.push(...(await deps.collectSupport(input.teamId, input.projectId, since)))

  const items = collected
    .filter((i) => sources.includes(i.source) && i.createdAt.getTime() >= since.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ source, text }) => ({ source, text }))

  const prepared = prepareLanguageInput(items, { maxItems: 300 })
  if (prepared.itemCount < MIN_LANGUAGE_ITEMS) {
    fail(
      409,
      'Conflict',
      ErrorCode.CONFLICT,
      `Not enough customer text from the last 90 days (${prepared.itemCount} of at least ${MIN_LANGUAGE_ITEMS} items)`,
      'too_few_items'
    )
  }

  const existingLabels = await deps.termLabels(input.siteId)

  // 4. Call the provider with the team's own key
  const model = LLM_MODELS[providerId].extract
  let result
  try {
    result = await deps.getProvider(providerId).extractStructured<unknown>({
      apiKey: key.apiKey,
      system: buildLanguageSystemPrompt(input.productName ?? 'this product'),
      input: prepared.text,
      schema: LANGUAGE_SCHEMA,
      schemaName: 'customer_language',
      model,
    })
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.kind === 'auth') {
        const transitioned = await deps.markInvalid(input.teamId, providerId, key.keyHint)
        if (transitioned) await deps.notifyInvalid(input.teamId, providerId).catch(() => undefined)
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
      fail(502, 'Bad Gateway', 'UPSTREAM_ERROR', 'The AI provider could not analyze the text. Try again')
    }
    throw err
  }

  await Promise.all([
    deps.record(input.teamId, `llm:${providerId}:input_tokens`, result.usage.inputTokens),
    deps.record(input.teamId, `llm:${providerId}:output_tokens`, result.usage.outputTokens),
    deps.record(
      input.teamId,
      `llm:${providerId}:cost_usd_micros`,
      estimateCostUsdMicros(providerId, model, result.model, result.usage)
    ),
    deps.record(input.teamId, 'language:runs', 1),
  ])

  let parsed: LanguageResult
  try {
    parsed = parseLanguageOutput(result.data, existingLabels)
  } catch (err) {
    if (err instanceof GenerationOutputError) {
      fail(502, 'Bad Gateway', 'UPSTREAM_ERROR', 'The AI provider returned an unreadable answer. Try again')
    }
    throw err
  }

  const usedSources = sources.filter((s) => items.some((i) => i.source === s))
  const id = randomUUID()
  await deps.saveInsight({
    id,
    siteId: input.siteId,
    provider: providerId,
    model: result.model || model,
    itemCount: prepared.itemCount,
    sources: usedSources,
    phrases: parsed.phrases,
    suggestedTerms: parsed.suggestedTerms,
    suggestedPrompts: parsed.suggestedPrompts,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    createdByUserId: input.userId,
  })

  return { id, provider: providerId, itemCount: prepared.itemCount, sources: usedSources, ...parsed }
}
