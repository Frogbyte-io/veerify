/**
 * Customer language runs. Privacy rule (design.md, security constraints): no
 * feedback or support text reaches an LLM provider unless the team has an
 * explicit consent for that source, re-read at run time. Message text is never
 * logged.
 */

import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gt, gte, lt, notInArray, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { customerLanguageInsight, marketingTerm } from '~/server/database/schema/marketing'
import type { LlmProviderId } from '~/server/services/llm'
import {
  callTeamLlm,
  failedBeforeProviderCall,
  type TeamLlmMessages,
  type TeamLlmRequest,
  type TeamLlmResult,
} from '~/server/services/marketing/llm-call'
import { pickSuggestionProvider } from '~/server/services/marketing/visibility/prompts'
import { listTeamCredentials } from '~/server/utils/team-credentials'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import {
  collectFeedbackItems,
  collectSupportItems,
  languageWindowStart,
  type CollectFeedbackOptions,
  type DatedItem,
} from './collect'
import { readConsent, type DataConsent } from './consent'
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

export { readConsent, type DataConsent }

export type LanguageSource = 'feedback' | 'support'
export type LanguageBlockReason = 'no_consent' | 'no_key' | 'daily_limit'

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

/**
 * Runs in the last 24 hours. Includes reservations (itemCount 0) of runs whose
 * provider call failed, because the provider was contacted.
 */
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
    return {
      reason: 'no_key',
      message: 'Add a valid Anthropic, OpenAI, Gemini or Perplexity API key in Marketing settings',
    }
  }
  if ((await countRecentRuns(input.siteId)) >= MAX_RUNS_PER_DAY) {
    return { reason: 'daily_limit', message: `At most ${MAX_RUNS_PER_DAY} analyses per product per day` }
  }
  return null
}

export interface LanguageRunDeps {
  readConsent(teamId: string): Promise<DataConsent>
  collectFeedback(projectId: string, since: Date, options?: CollectFeedbackOptions): Promise<DatedItem[]>
  collectSupport(teamId: string, projectId: string, since: Date): Promise<DatedItem[]>
  listCredentials(teamId: string): Promise<{ provider: string; status: string }[]>
  countRecentRuns(siteId: string): Promise<number>
  termLabels(siteId: string): Promise<string[]>
  callLlm(teamId: string, request: TeamLlmRequest, messages: TeamLlmMessages): Promise<TeamLlmResult<unknown>>
  /**
   * Atomically checks the daily limit and reserves a run (a placeholder row with
   * itemCount 0). Returns the run id, or null when the limit is reached.
   */
  claimRun(siteId: string, userId: string, now: Date): Promise<string | null>
  /** Gives the reservation back; used when the provider was never contacted */
  releaseRun(id: string): Promise<void>
  completeRun(id: string, row: typeof customerLanguageInsight.$inferInsert, now: Date): Promise<void>
  now(): Date
}

const DAY_MS = 24 * 60 * 60 * 1000

const defaultDeps: LanguageRunDeps = {
  readConsent,
  collectFeedback: collectFeedbackItems,
  collectSupport: collectSupportItems,
  listCredentials: listTeamCredentials,
  countRecentRuns,
  async termLabels(siteId) {
    const rows = await db
      .select({ label: marketingTerm.label })
      .from(marketingTerm)
      .where(eq(marketingTerm.siteId, siteId))
    return rows.map((r) => r.label)
  },
  callLlm: callTeamLlm,
  async claimRun(siteId, userId, now) {
    return db.transaction(async (tx) => {
      // Serialises concurrent runs for this site: the check and the insert are atomic
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer_language:${siteId}`}, 0))`)
      const since = new Date(now.getTime() - DAY_MS)
      const [row] = await tx
        .select({ n: count() })
        .from(customerLanguageInsight)
        .where(and(eq(customerLanguageInsight.siteId, siteId), gte(customerLanguageInsight.createdAt, since)))
      if (Number(row?.n ?? 0) >= MAX_RUNS_PER_DAY) return null
      const id = randomUUID()
      await tx.insert(customerLanguageInsight).values({
        id,
        siteId,
        provider: 'pending',
        model: '',
        itemCount: 0,
        createdByUserId: userId,
        createdAt: now,
      })
      return id
    })
  },
  async releaseRun(id) {
    await db.delete(customerLanguageInsight).where(eq(customerLanguageInsight.id, id))
  },
  async completeRun(id, row, now) {
    await db
      .update(customerLanguageInsight)
      .set({ ...row, id: undefined, createdAt: now })
      .where(eq(customerLanguageInsight.id, id))
    // Keep the newest KEEP_INSIGHTS finished runs per site. Reservations of failed
    // provider calls stay for 24 hours so they keep counting toward the daily limit.
    const keep = await db
      .select({ id: customerLanguageInsight.id })
      .from(customerLanguageInsight)
      .where(and(eq(customerLanguageInsight.siteId, row.siteId), gt(customerLanguageInsight.itemCount, 0)))
      .orderBy(desc(customerLanguageInsight.createdAt))
      .limit(KEEP_INSIGHTS)
    await db.delete(customerLanguageInsight).where(
      and(
        eq(customerLanguageInsight.siteId, row.siteId),
        or(
          and(
            gt(customerLanguageInsight.itemCount, 0),
            notInArray(
              customerLanguageInsight.id,
              keep.map((k) => k.id)
            )
          ),
          and(
            eq(customerLanguageInsight.itemCount, 0),
            lt(customerLanguageInsight.createdAt, new Date(now.getTime() - DAY_MS))
          )
        )
      )
    )
  },
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

const NO_KEY_MESSAGE = 'Add a valid Anthropic, OpenAI, Gemini or Perplexity API key to run an analysis'

function limitReached(): never {
  fail(
    429,
    'Too Many Requests',
    ErrorCode.RATE_LIMITED,
    `You can run at most ${MAX_RUNS_PER_DAY} analyses per product per day`,
    'daily_limit'
  )
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

  // 2. Cheap guards before reading any customer text (key and budget are enforced again by callTeamLlm)
  const credentials = await deps.listCredentials(input.teamId)
  if (!pickSuggestionProvider(credentials)) fail(409, 'Conflict', ErrorCode.CONFLICT, NO_KEY_MESSAGE, 'no_key')
  if ((await deps.countRecentRuns(input.siteId)) >= MAX_RUNS_PER_DAY) limitReached()

  // 3. Collect from consented sources only, for this product, in the window.
  // Support-derived feedback is only read (and labelled support) with support consent.
  const now = deps.now()
  const since = languageWindowStart(now)
  const collected: DatedItem[] = []
  if (consent.allowFeedbackText) {
    collected.push(
      ...(await deps.collectFeedback(input.projectId, since, { includeSupportDerived: consent.allowSupportText }))
    )
  }
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

  // 4. Reserve a run atomically (race-safe daily limit), then call the provider with the team's own key
  const runId = await deps.claimRun(input.siteId, input.userId, now)
  if (!runId) limitReached()

  let result: TeamLlmResult<unknown>
  try {
    result = await deps.callLlm(
      input.teamId,
      {
        system: buildLanguageSystemPrompt(input.productName ?? 'this product'),
        input: prepared.text,
        schema: LANGUAGE_SCHEMA,
        schemaName: 'customer_language',
        extraUsageMetrics: { 'language:runs': 1 },
      },
      { noKey: NO_KEY_MESSAGE, upstream: 'The AI provider could not analyze the text. Try again' }
    )
  } catch (err) {
    // A run only counts toward the limit when the provider was actually contacted
    if (failedBeforeProviderCall(err)) await deps.releaseRun(runId).catch(() => undefined)
    throw err
  }

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
  await deps.completeRun(
    runId,
    {
      id: runId,
      siteId: input.siteId,
      provider: result.provider,
      model: result.model,
      itemCount: prepared.itemCount,
      sources: usedSources,
      phrases: parsed.phrases,
      suggestedTerms: parsed.suggestedTerms,
      suggestedPrompts: parsed.suggestedPrompts,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      createdByUserId: input.userId,
    },
    deps.now()
  )

  return { id: runId, provider: result.provider, itemCount: prepared.itemCount, sources: usedSources, ...parsed }
}
