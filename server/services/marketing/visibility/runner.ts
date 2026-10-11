/**
 * AI visibility runner.
 *
 * A run fans out into one `pending` answer row per prompt x provider x sample.
 * `advanceVisibilityRuns` (scheduled every minute) claims pending rows in small
 * batches and answers them within a time budget, so no request or task is long
 * running and the work spreads over as many ticks as it needs.
 *
 * Claiming: the answer table has no lease column, so a claim stamps
 * `completed_at` on the still-`pending` row and a row is claimable again when
 * that stamp is older than the lease. `FOR UPDATE SKIP LOCKED` keeps concurrent
 * ticks from claiming the same rows. A crashed worker's rows return to the
 * queue after the lease lapses; a completed row's `completed_at` is the finish
 * time as usual.
 *
 * Logging: only ids, providers and error kinds. Prompts, answers, keys and
 * provider response bodies are never logged.
 */

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, lt, max, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  aiVisibilityAnswer,
  aiVisibilityPrompt,
  aiVisibilityRun,
  marketingSite,
  marketingTerm,
  type SeoAuditTrigger,
} from '~/server/database/schema/marketing'
import { project } from '~/server/database/schema/feedback'
import { teamMember, user } from '~/server/database/schema/auth'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import { sendMarketingCredentialInvalidEmail } from '~/lib/email'
import {
  getLlmProvider,
  LlmProviderError,
  LLM_MODELS,
  LLM_PROVIDERS,
  type LlmAnswer,
  type LlmProvider,
  type LlmProviderId,
} from '~/server/services/llm'
import { estimateCostUsdMicros } from '~/server/services/llm/models'
import {
  getTeamApiKey,
  listTeamCredentials,
  markCredentialInvalid,
  markCredentialValid,
  type TeamApiKey,
} from '~/server/utils/team-credentials'
import { recordUsage } from '~/server/utils/marketing-usage'
import {
  estimateVisibilityReservation,
  heldMicros,
  releaseBudget,
  reserveBudget,
  budgetRefusalReason,
  settleBudget,
} from '~/server/services/marketing/llm-budget'
import { createLogger } from '~/server/utils/logger'
import { buildAnalysis, buildExtractionSystemPrompt, EXTRACTION_SCHEMA } from './analysis'
import type { AnswerAnalysis, AnswerExtraction, MarketingTermInput } from './types'

const logger = createLogger('marketing:visibility')

export const DEFAULT_SAMPLES_PER_PROMPT = 3
/** A claimed answer is retried by another tick if still pending after this long */
export const CLAIM_LEASE_MS = 3 * 60 * 1000
/** The scheduled weekly run happens when the last run is older than this */
export const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/** Pending answers older than this are failed ("Timed out") so a run can never hang forever */
export const ANSWER_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Finished runs kept per site; older ones (and their answers) are deleted */
export const RUN_RETENTION = 12

/** Postgres unique_violation, possibly wrapped by the driver/ORM */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/**
 * Whether estimated month-to-date spend plus in-flight reservations for a provider has reached the
 * key's budget. For reads (UI, setup checks); calls go through `reserveBudget`.
 */
export function budgetExhausted(
  usage: Record<string, number>,
  provider: string,
  monthlyBudgetCents: number | null
): boolean {
  if (monthlyBudgetCents == null) return false
  const spent = (usage[`llm:${provider}:cost_usd_micros`] ?? 0) + (usage[`llm:${provider}:reserved_usd_micros`] ?? 0)
  return spent >= monthlyBudgetCents * 10_000
}

export const LLM_PROVIDER_IDS: LlmProviderId[] = LLM_PROVIDERS.map((p) => p.id)

export type VisibilityRunErrorCode = 'site_unverified' | 'no_brand' | 'no_prompts' | 'no_key' | 'already_running'

export class VisibilityRunError extends Error {
  constructor(
    readonly code: VisibilityRunErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VisibilityRunError'
  }
}

const RUN_ERROR_MESSAGES: Record<VisibilityRunErrorCode, string> = {
  site_unverified: 'Verify your site before running AI visibility',
  no_brand: 'Add at least one brand term before running AI visibility',
  no_prompts: 'Add at least one active prompt before running AI visibility',
  no_key: 'Add a valid Anthropic, OpenAI, Gemini or Perplexity API key before running AI visibility',
  already_running: 'A run is already queued or in progress for this site',
}

function runError(code: VisibilityRunErrorCode) {
  return new VisibilityRunError(code, RUN_ERROR_MESSAGES[code])
}

// ---------------------------------------------------------------------------
// createRun
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  siteId: string
  trigger: SeoAuditTrigger
  /** Restrict to these providers; defaults to every provider with a usable key */
  providers?: LlmProviderId[]
  samplesPerPrompt?: number
}

export async function createRun(input: CreateRunInput) {
  const [site] = await db
    .select({ id: marketingSite.id, teamId: marketingSite.teamId, verifiedAt: marketingSite.verifiedAt })
    .from(marketingSite)
    .where(eq(marketingSite.id, input.siteId))
    .limit(1)
  if (!site || !site.verifiedAt) throw runError('site_unverified')

  const brandTerms = await db
    .select({ id: marketingTerm.id })
    .from(marketingTerm)
    .where(and(eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'brand')))
    .limit(1)
  if (brandTerms.length === 0) throw runError('no_brand')

  const prompts = await db
    .select({ id: aiVisibilityPrompt.id })
    .from(aiVisibilityPrompt)
    .where(and(eq(aiVisibilityPrompt.siteId, site.id), eq(aiVisibilityPrompt.active, true)))
  if (prompts.length === 0) throw runError('no_prompts')

  const credentials = await listTeamCredentials(site.teamId)
  let providers = credentials
    .filter((c) => c.status !== 'invalid')
    .map((c) => c.provider)
    .filter((p): p is LlmProviderId => (LLM_PROVIDER_IDS as string[]).includes(p))
  if (input.providers) providers = providers.filter((p) => input.providers!.includes(p))
  providers = [...new Set(providers)]
  if (providers.length === 0) throw runError('no_key')

  const active = await db
    .select({ id: aiVisibilityRun.id })
    .from(aiVisibilityRun)
    .where(and(eq(aiVisibilityRun.siteId, site.id), inArray(aiVisibilityRun.status, ['queued', 'running'])))
    .limit(1)
  if (active.length > 0) throw runError('already_running')

  const samples = Math.max(1, Math.min(10, input.samplesPerPrompt ?? DEFAULT_SAMPLES_PER_PROMPT))
  const now = new Date()
  const runId = randomUUID()

  const answers = prompts.flatMap((prompt) =>
    providers.flatMap((provider) =>
      Array.from({ length: samples }, (_, i) => ({
        id: randomUUID(),
        runId,
        promptId: prompt.id,
        provider,
        model: LLM_MODELS[provider].answer,
        sample: i + 1,
        status: 'pending' as const,
        createdAt: now,
      }))
    )
  )

  let run
  try {
    run = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(aiVisibilityRun)
        .values({
          id: runId,
          siteId: site.id,
          trigger: input.trigger,
          status: 'queued',
          samplesPerPrompt: samples,
          providers,
          createdAt: now,
        })
        .returning()
      await tx.insert(aiVisibilityAnswer).values(answers)
      return created
    })
  } catch (err) {
    // The partial unique index on (site_id) WHERE status IN ('queued','running') closes the check-then-insert race
    if (isUniqueViolation(err)) throw runError('already_running')
    throw err
  }

  return { run, answerCount: answers.length }
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

export interface ClaimedAnswer {
  id: string
  runId: string
  promptId: string
  provider: LlmProviderId
  sample: number
}

export interface AnswerContext {
  teamId: string
  promptText: string
  terms: MarketingTermInput[]
  brandLabel: string | null
  /** Set when the run may no longer call providers (module off, site unverified) */
  blockedReason?: string | null
}

export interface SavedAnswer {
  model: string
  answer: string
  citations: { url: string; title?: string | null }[]
  analysis: AnswerAnalysis
  inputTokens: number
  outputTokens: number
}

/** Side effects of the runner, injectable so the logic is testable without a database. */
export interface RunnerDeps {
  now: () => number
  claim: (limit: number, excludeProviders: string[]) => Promise<ClaimedAnswer[]>
  release: (answerId: string) => Promise<void>
  markRunsRunning: (runIds: string[]) => Promise<void>
  loadContext: (answer: ClaimedAnswer) => Promise<AnswerContext | null>
  getKey: (teamId: string, provider: LlmProviderId) => Promise<TeamApiKey | null>
  /** Atomic budget reservation (see llm-budget.ts); false when the cap would be exceeded */
  reserveBudget: (teamId: string, provider: string, amountMicros: number, capCents: number | null) => Promise<boolean>
  budgetRefusalReason: (
    teamId: string,
    provider: string,
    amountMicros: number,
    capCents: number
  ) => Promise<'cap' | 'in_flight'>
  /** Replaces a reservation with the actual spend */
  settleBudget: (teamId: string, provider: string, reservedMicros: number, actualMicros: number) => Promise<void>
  releaseBudget: (teamId: string, provider: string, reservedMicros: number) => Promise<void>
  recordUsage: (teamId: string, metric: string, units: number) => Promise<void>
  markInvalid: (teamId: string, provider: LlmProviderId, message: string, keyHint?: string) => Promise<boolean>
  markValid: (teamId: string, provider: LlmProviderId, keyHint?: string) => Promise<void>
  notifyInvalid: (teamId: string, provider: LlmProviderId) => Promise<void>
  failAnswer: (answerId: string, error: string) => Promise<void>
  failPendingForProvider: (runId: string, provider: LlmProviderId, error: string) => Promise<void>
  /** Resolves false when the row was no longer pending (already handled elsewhere) */
  saveAnswer: (answerId: string, data: SavedAnswer) => Promise<boolean>
  finalizeRuns: (runIds: string[]) => Promise<void>
  /** Fails answers pending longer than ANSWER_MAX_AGE_MS and finalizes every queued/running run with nothing pending */
  sweepStuckRuns?: () => Promise<void>
  getProvider: (id: LlmProviderId) => LlmProvider
}

export interface AdvanceOptions {
  budgetMs?: number
  concurrency?: number
}

export interface AdvanceResult {
  claimed: number
  done: number
  failed: number
}

type Outcome = 'done' | 'failed' | 'released'

export async function advanceVisibilityRuns(
  options: AdvanceOptions = {},
  deps: RunnerDeps = createDefaultDeps()
): Promise<AdvanceResult> {
  const budgetMs = options.budgetMs ?? 45_000
  const concurrency = options.concurrency ?? 3
  const deadline = deps.now() + budgetMs
  const stopped = new Set<LlmProviderId>()
  const invalidated = new Set<LlmProviderId>()
  const touchedRuns = new Set<string>()
  const result: AdvanceResult = { claimed: 0, done: 0, failed: 0 }

  try {
    await deps.sweepStuckRuns?.()
  } catch (err) {
    logger.error('Visibility sweep failed', { error: err instanceof Error ? err.name : 'unknown' })
  }

  try {
    while (deps.now() < deadline) {
      const batch = await deps.claim(concurrency, [...stopped])
      if (batch.length === 0) break
      result.claimed += batch.length
      const runIds = [...new Set(batch.map((a) => a.runId))]
      runIds.forEach((id) => touchedRuns.add(id))
      await deps.markRunsRunning(runIds)

      const outcomes = await Promise.all(
        batch.map(async (answer): Promise<Outcome> => {
          if (stopped.has(answer.provider)) {
            // Provider was stopped by a sibling in this batch
            await deps.release(answer.id)
            return 'released'
          }
          try {
            return await processAnswer(answer, deps, stopped, invalidated)
          } catch (err) {
            logger.error('Visibility answer processing crashed', {
              answerId: answer.id,
              error: err instanceof Error ? err.name : 'unknown',
            })
            await deps.failAnswer(answer.id, 'Unexpected error while processing this answer').catch(() => undefined)
            return 'failed'
          }
        })
      )
      for (const outcome of outcomes) {
        if (outcome === 'done') result.done++
        else if (outcome === 'failed') result.failed++
      }
      await deps.finalizeRuns(runIds)
    }
  } finally {
    // Catches runs whose last pending answers were failed in bulk
    if (touchedRuns.size > 0) await deps.finalizeRuns([...touchedRuns]).catch(() => undefined)
  }

  return result
}

async function processAnswer(
  answer: ClaimedAnswer,
  deps: RunnerDeps,
  stopped: Set<LlmProviderId>,
  invalidated: Set<LlmProviderId>
): Promise<Outcome> {
  const context = await deps.loadContext(answer)
  if (!context) {
    await deps.failAnswer(answer.id, 'Prompt or site is no longer available')
    return 'failed'
  }
  if (!context.brandLabel) {
    await deps.failAnswer(answer.id, 'No brand term is configured')
    return 'failed'
  }

  if (context.blockedReason) {
    await failProvider(answer, deps, stopped, context.blockedReason)
    return 'failed'
  }

  const { teamId } = context
  const provider = answer.provider

  const key = await deps.getKey(teamId, provider)
  if (!key) {
    await failProvider(answer, deps, stopped, 'No API key is configured for this provider')
    return 'failed'
  }
  if (key.status === 'invalid') {
    await failProvider(answer, deps, stopped, 'The API key for this provider was rejected')
    return 'failed'
  }

  const llm = deps.getProvider(provider)
  const answerModel = LLM_MODELS[provider].answer
  const extractModel = LLM_MODELS[provider].extract
  const extractionSystem = buildExtractionSystemPrompt(context.brandLabel)

  // Reserve an upper bound for the answer and the extraction together, so concurrent answers cannot
  // all pass the monthly cap check. Settled with the actual cost, released if nothing was spent.
  const held = heldMicros(
    estimateVisibilityReservation(provider, answerModel, extractModel, context.promptText, extractionSystem),
    key.monthlyBudgetCents
  )
  if (!(await deps.reserveBudget(teamId, provider, held, key.monthlyBudgetCents))) {
    // Only a real cap fails the provider's answers. If the refusal came from other answers'
    // reservations still in flight, leave this one pending for the next tick (bounded by the 24h
    // pending-answer timeout) instead of failing work that may fit once they settle.
    const reason =
      key.monthlyBudgetCents == null
        ? 'cap'
        : await deps.budgetRefusalReason(teamId, provider, held, key.monthlyBudgetCents)
    if (reason === 'in_flight') {
      stopped.add(provider)
      await deps.release(answer.id)
      return 'released'
    }
    await failProvider(answer, deps, stopped, 'Monthly budget reached for this provider')
    return 'failed'
  }
  let settled = false
  try {
    let answered: LlmAnswer
    try {
      answered = await llm.answerWithSearch({
        apiKey: key.apiKey,
        prompt: context.promptText,
        model: answerModel,
      })
    } catch (err) {
      return await handleProviderError(err, answer, teamId, key.keyHint, deps, stopped, invalidated)
    }

    let totalIn = answered.usage.inputTokens
    let totalOut = answered.usage.outputTokens
    let costMicros = estimateCostUsdMicros(provider, answerModel, answered.model, answered.usage)

    let extraction: AnswerExtraction | null = null
    try {
      const extracted = await llm.extractStructured<AnswerExtraction>({
        apiKey: key.apiKey,
        system: extractionSystem,
        input: answered.text,
        schema: EXTRACTION_SCHEMA,
        schemaName: 'answer_extraction',
        model: extractModel,
      })
      extraction = extracted.data
      totalIn += extracted.usage.inputTokens
      totalOut += extracted.usage.outputTokens
      costMicros += estimateCostUsdMicros(provider, extractModel, extracted.model, extracted.usage)
    } catch (err) {
      // The answer is still valuable: fall back to deterministic ranking
      logger.warn('Visibility extraction failed; using deterministic analysis', {
        answerId: answer.id,
        provider,
        kind: err instanceof LlmProviderError ? err.kind : 'unknown',
      })
    }

    // The spend is real from here on, whatever happens to the row
    await deps.settleBudget(teamId, provider, held, costMicros)
    settled = true

    const analysis = buildAnalysis(answered.text, answered.citations, context.terms, extraction)
    const saved = await deps.saveAnswer(answer.id, {
      model: answered.model,
      answer: answered.text,
      citations: answered.citations.map((c) => ({ url: c.url, title: c.title ?? null })),
      analysis,
      inputTokens: totalIn,
      outputTokens: totalOut,
    })

    await Promise.all([
      deps.recordUsage(teamId, `llm:${provider}:input_tokens`, totalIn),
      deps.recordUsage(teamId, `llm:${provider}:output_tokens`, totalOut),
      deps.recordUsage(teamId, 'visibility:answers', 1),
    ])

    // Not saved: another worker already settled this row. The spend above is real, so usage is still recorded.
    if (saved === false) return 'released'

    if (key.status === 'unchecked') await deps.markValid(teamId, provider, key.keyHint)
    return 'done'
  } finally {
    // Provider failed or the worker crashed before settling: give the reservation back
    if (!settled) await deps.releaseBudget(teamId, provider, held).catch(() => undefined)
  }
}

/** Fail this answer and every other pending answer for the provider in its run. */
async function failProvider(answer: ClaimedAnswer, deps: RunnerDeps, stopped: Set<LlmProviderId>, message: string) {
  stopped.add(answer.provider)
  await deps.failAnswer(answer.id, message)
  await deps.failPendingForProvider(answer.runId, answer.provider, message)
}

async function handleProviderError(
  err: unknown,
  answer: ClaimedAnswer,
  teamId: string,
  keyHint: string | undefined,
  deps: RunnerDeps,
  stopped: Set<LlmProviderId>,
  invalidated: Set<LlmProviderId>
): Promise<Outcome> {
  const provider = answer.provider

  if (err instanceof LlmProviderError) {
    if (err.kind === 'auth') {
      // Concurrent answers in one batch can all hit the same 401; handle the key once per tick
      const first = !invalidated.has(provider)
      invalidated.add(provider)
      stopped.add(provider)
      const transitioned =
        first && (await deps.markInvalid(teamId, provider, 'The provider rejected the API key', keyHint))
      await failProvider(answer, deps, stopped, 'The API key for this provider was rejected')
      if (transitioned) await deps.notifyInvalid(teamId, provider).catch(() => undefined)
      return 'failed'
    }
    if (err.kind === 'quota') {
      // Out of credit: retrying cannot help and the key itself is fine
      await failProvider(
        answer,
        deps,
        stopped,
        'The provider account is out of credit or quota. Add credit with the provider and run again'
      )
      return 'failed'
    }
    if (err.kind === 'rate_limit') {
      // Leave it pending for the next tick and stop hammering this provider.
      // Bounded by the 24h pending-answer timeout in the sweep.
      stopped.add(provider)
      await deps.release(answer.id)
      return 'released'
    }
    await deps.failAnswer(answer.id, `Provider error (${err.kind}${err.status ? `, ${err.status}` : ''})`)
    return 'failed'
  }

  await deps.failAnswer(answer.id, 'Unexpected provider error')
  return 'failed'
}

// ---------------------------------------------------------------------------
// Default (database-backed) dependencies
// ---------------------------------------------------------------------------

export async function notifyCredentialInvalid(teamId: string, provider: LlmProviderId): Promise<void> {
  const admins = await db
    .select({ email: user.email })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'admin')))

  const baseUrl = (process.env.BETTER_AUTH_URL || '').replace(/\/$/, '')
  const providerLabel = LLM_PROVIDERS.find((p) => p.id === provider)?.label ?? provider
  for (const admin of admins) {
    try {
      await sendMarketingCredentialInvalidEmail({
        to: admin.email,
        providerLabel,
        settingsUrl: `${baseUrl}/marketing/settings`,
      })
    } catch (err) {
      logger.warn('Failed to send credential-invalid email', {
        teamId,
        provider,
        error: err instanceof Error ? err.name : 'unknown',
      })
    }
  }
}

export function createDefaultDeps(): RunnerDeps {
  const runContext = new Map<
    string,
    Promise<{ teamId: string; terms: MarketingTermInput[]; brandLabel: string | null; blockedReason: string | null }>
  >()
  const prompts = new Map<string, Promise<string | null>>()

  return {
    now: () => Date.now(),

    async claim(limit, excludeProviders) {
      const now = new Date()
      const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)
      const exclusion =
        excludeProviders.length > 0
          ? sql`AND a.provider NOT IN (${sql.join(
              excludeProviders.map((p) => sql`${p}`),
              sql`, `
            )})`
          : sql``
      const res = await db.execute<{
        id: string
        run_id: string
        prompt_id: string
        provider: LlmProviderId
        sample: number
      }>(sql`
        UPDATE ai_visibility_answer
        SET completed_at = ${now}
        WHERE id IN (
          SELECT a.id
          FROM ai_visibility_answer a
          JOIN ai_visibility_run r ON r.id = a.run_id
          WHERE a.status = 'pending'
            AND r.status IN ('queued', 'running')
            AND (a.completed_at IS NULL OR a.completed_at < ${staleBefore})
            ${exclusion}
          ORDER BY a.created_at ASC, a.id ASC
          LIMIT ${limit}
          FOR UPDATE OF a SKIP LOCKED
        )
        RETURNING id, run_id, prompt_id, provider, sample
      `)
      return res.rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        promptId: row.prompt_id,
        provider: row.provider,
        sample: row.sample,
      }))
    },

    async release(answerId) {
      await db
        .update(aiVisibilityAnswer)
        .set({ completedAt: null })
        .where(and(eq(aiVisibilityAnswer.id, answerId), eq(aiVisibilityAnswer.status, 'pending')))
    },

    async markRunsRunning(runIds) {
      await db
        .update(aiVisibilityRun)
        .set({ status: 'running', startedAt: new Date() })
        .where(and(inArray(aiVisibilityRun.id, runIds), eq(aiVisibilityRun.status, 'queued')))
    },

    async loadContext(answer) {
      if (!runContext.has(answer.runId)) {
        runContext.set(
          answer.runId,
          (async () => {
            const [row] = await db
              .select({
                siteId: marketingSite.id,
                teamId: marketingSite.teamId,
                verifiedAt: marketingSite.verifiedAt,
                projectSettings: project.settings,
                teamEnabled: teamModuleSettings.marketingEnabled,
              })
              .from(aiVisibilityRun)
              .innerJoin(marketingSite, eq(marketingSite.id, aiVisibilityRun.siteId))
              .innerJoin(project, eq(project.id, marketingSite.projectId))
              .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
              .where(eq(aiVisibilityRun.id, answer.runId))
              .limit(1)
            if (!row) throw new Error('run not found')
            const teamEnabled = row.teamEnabled ?? DEFAULT_TEAM_MODULES.marketingEnabled
            const productEnabled = resolveProductModules(row.projectSettings).marketingEnabled
            const blockedReason =
              teamEnabled !== true || !productEnabled
                ? 'Marketing is turned off for this product'
                : !row.verifiedAt
                  ? 'Site is no longer verified'
                  : null
            const terms = await db.select().from(marketingTerm).where(eq(marketingTerm.siteId, row.siteId))
            const inputs: MarketingTermInput[] = terms.map((t) => ({
              id: t.id,
              kind: t.kind,
              label: t.label,
              aliases: t.aliases,
            }))
            return {
              teamId: row.teamId,
              terms: inputs,
              brandLabel: inputs.find((t) => t.kind === 'brand')?.label ?? null,
              blockedReason,
            }
          })()
        )
      }
      if (!prompts.has(answer.promptId)) {
        prompts.set(
          answer.promptId,
          db
            .select({ text: aiVisibilityPrompt.text })
            .from(aiVisibilityPrompt)
            .where(eq(aiVisibilityPrompt.id, answer.promptId))
            .limit(1)
            .then((rows) => rows[0]?.text ?? null)
        )
      }
      try {
        const [ctx, promptText] = await Promise.all([runContext.get(answer.runId)!, prompts.get(answer.promptId)!])
        if (promptText == null) return null
        return { ...ctx, promptText }
      } catch {
        return null
      }
    },

    getKey: getTeamApiKey,
    reserveBudget,
    budgetRefusalReason,
    settleBudget,
    releaseBudget,
    recordUsage,
    markInvalid: markCredentialInvalid,
    markValid: markCredentialValid,
    notifyInvalid: notifyCredentialInvalid,

    async failAnswer(answerId, error) {
      await db
        .update(aiVisibilityAnswer)
        .set({ status: 'failed', error, completedAt: new Date() })
        .where(and(eq(aiVisibilityAnswer.id, answerId), eq(aiVisibilityAnswer.status, 'pending')))
    },

    async failPendingForProvider(runId, provider, error) {
      await db
        .update(aiVisibilityAnswer)
        .set({ status: 'failed', error, completedAt: new Date() })
        .where(
          and(
            eq(aiVisibilityAnswer.runId, runId),
            eq(aiVisibilityAnswer.provider, provider),
            eq(aiVisibilityAnswer.status, 'pending')
          )
        )
    },

    async saveAnswer(answerId, data) {
      const rows = await db
        .update(aiVisibilityAnswer)
        .set({
          status: 'done',
          model: data.model,
          answer: data.answer,
          citations: data.citations,
          brandMentioned: data.analysis.brandMentioned,
          brandRank: data.analysis.brandRank,
          competitorsMentioned: data.analysis.competitorsMentioned,
          citationDomains: data.analysis.citationDomains,
          brandSentiment: data.analysis.brandSentiment,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          error: null,
          completedAt: new Date(),
        })
        .where(and(eq(aiVisibilityAnswer.id, answerId), eq(aiVisibilityAnswer.status, 'pending')))
        .returning({ id: aiVisibilityAnswer.id })
      return rows.length > 0
    },

    sweepStuckRuns: sweepStuckVisibilityRuns,
    finalizeRuns: finalizeVisibilityRuns,
    getProvider: getLlmProvider,
  }
}

/**
 * Fails answers pending past ANSWER_MAX_AGE_MS, then finalizes EVERY queued or
 * running run (not just ones touched this tick) so a run whose answers were all
 * settled elsewhere, or that never had any, cannot stay stuck.
 */
export async function sweepStuckVisibilityRuns(now: Date = new Date()): Promise<void> {
  await db
    .update(aiVisibilityAnswer)
    .set({ status: 'failed', error: 'Timed out', completedAt: now })
    .where(
      and(
        eq(aiVisibilityAnswer.status, 'pending'),
        lt(aiVisibilityAnswer.createdAt, new Date(now.getTime() - ANSWER_MAX_AGE_MS))
      )
    )
  const active = await db
    .select({ id: aiVisibilityRun.id })
    .from(aiVisibilityRun)
    .where(inArray(aiVisibilityRun.status, ['queued', 'running']))
  await finalizeVisibilityRuns(active.map((r) => r.id))
}

/**
 * Completes runs that have no pending answers left: `done` when every answer
 * succeeded, `failed` when none did (or the run has no answers at all, with an
 * explanatory error), `partial` otherwise. Afterwards keeps only the
 * RUN_RETENTION most recent finished runs per affected site.
 */
export async function finalizeVisibilityRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return
  const rows = await db
    .select({
      runId: aiVisibilityAnswer.runId,
      pending: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'pending')`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'done')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${aiVisibilityAnswer.status} = 'failed')`.mapWith(Number),
    })
    .from(aiVisibilityAnswer)
    .where(inArray(aiVisibilityAnswer.runId, runIds))
    .groupBy(aiVisibilityAnswer.runId)

  const active = inArray(aiVisibilityRun.status, ['queued', 'running'])
  const finished: string[] = []

  for (const row of rows) {
    if (row.pending > 0) continue
    const status = row.failed === 0 ? 'done' : row.done === 0 ? 'failed' : 'partial'
    await db
      .update(aiVisibilityRun)
      .set({ status, finishedAt: new Date() })
      .where(and(eq(aiVisibilityRun.id, row.runId), active))
    finished.push(row.runId)
  }

  // Runs with no answer rows at all would otherwise stay queued forever
  const withAnswers = new Set(rows.map((r) => r.runId))
  const empty = runIds.filter((id) => !withAnswers.has(id))
  if (empty.length > 0) {
    await db
      .update(aiVisibilityRun)
      .set({ status: 'failed', error: 'The run has no answers to process', finishedAt: new Date() })
      .where(and(inArray(aiVisibilityRun.id, empty), active))
    finished.push(...empty)
  }

  if (finished.length > 0) await pruneFinishedRuns(finished)
}

/** Keeps the RUN_RETENTION newest finished runs per site; answers cascade. */
async function pruneFinishedRuns(runIds: string[]): Promise<void> {
  try {
    const sites = await db
      .selectDistinct({ siteId: aiVisibilityRun.siteId })
      .from(aiVisibilityRun)
      .where(inArray(aiVisibilityRun.id, runIds))
    for (const { siteId } of sites) {
      await db.execute(sql`
        DELETE FROM ai_visibility_run
        WHERE site_id = ${siteId}
          AND status IN ('done', 'partial', 'failed')
          AND id NOT IN (
            SELECT id FROM ai_visibility_run
            WHERE site_id = ${siteId} AND status IN ('done', 'partial', 'failed')
            ORDER BY created_at DESC, id DESC
            LIMIT ${RUN_RETENTION}
          )
      `)
    }
  } catch (err) {
    logger.warn('Visibility run retention failed', { error: err instanceof Error ? err.name : 'unknown' })
  }
}

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  created: number
  skipped: number
}

/** Creates a `schedule` run for each eligible site whose last run is older than 7 days. */
export async function scheduleWeeklyVisibilityRuns(now: Date = new Date()): Promise<ScheduleResult> {
  const candidates = await db
    .select({ siteId: marketingSite.id, projectSettings: project.settings })
    .from(marketingSite)
    .innerJoin(project, eq(project.id, marketingSite.projectId))
    .innerJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
    .where(and(eq(teamModuleSettings.marketingEnabled, true), sql`${marketingSite.verifiedAt} is not null`))

  const result: ScheduleResult = { created: 0, skipped: 0 }
  const cutoff = now.getTime() - WEEKLY_INTERVAL_MS

  for (const candidate of candidates) {
    if (!resolveProductModules(candidate.projectSettings).marketingEnabled) {
      result.skipped++
      continue
    }
    const [last] = await db
      .select({ lastAt: max(aiVisibilityRun.createdAt) })
      .from(aiVisibilityRun)
      .where(eq(aiVisibilityRun.siteId, candidate.siteId))
    if (last?.lastAt && last.lastAt.getTime() > cutoff) {
      result.skipped++
      continue
    }
    try {
      await createRun({ siteId: candidate.siteId, trigger: 'schedule' })
      result.created++
    } catch (err) {
      if (!(err instanceof VisibilityRunError)) {
        logger.error('Scheduled visibility run failed to start', {
          siteId: candidate.siteId,
          error: err instanceof Error ? err.name : 'unknown',
        })
      }
      result.skipped++
    }
  }

  return result
}
