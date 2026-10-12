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
 * Throughput: a worker pool (default 12 answers in flight, `MARKETING_VISIBILITY_CONCURRENCY`) with a
 * per-provider cap (default 4, `MARKETING_VISIBILITY_PROVIDER_CONCURRENCY`), refilled as answers finish,
 * so a slow provider only ever holds its own slots. Claims walk the pending partial index in
 * `(created_at, id)` order, one cheap query per provider with remaining capacity.
 *
 * Logging: only ids, providers and error kinds. Prompts, answers, keys and
 * provider response bodies are never logged.
 */

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
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
import { sqlTimestamp } from '~/server/utils/sql-timestamp'
import { marketingConfig } from '~/server/utils/marketing-config'
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
  /**
   * Claims up to `limit` pending answers, oldest first, never more than `capacity[provider]` for a
   * provider and none for `excludeProviders`.
   */
  claim: (limit: number, excludeProviders: string[], capacity: Record<string, number>) => Promise<ClaimedAnswer[]>
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
  finalizeRuns: (runIds?: string[]) => Promise<void>
  /** Fails answers pending longer than ANSWER_MAX_AGE_MS and finalizes every queued/running run with nothing pending */
  sweepStuckRuns?: () => Promise<void>
  getProvider: (id: LlmProviderId) => LlmProvider
}

export interface AdvanceOptions {
  budgetMs?: number
  /** Answers in flight across all providers (default: MARKETING_VISIBILITY_CONCURRENCY, 12) */
  concurrency?: number
  /** Answers in flight per provider (default: MARKETING_VISIBILITY_PROVIDER_CONCURRENCY, 4) */
  perProviderConcurrency?: number
}

export interface AdvanceResult {
  claimed: number
  done: number
  failed: number
}

type Outcome = 'done' | 'failed' | 'released'

/**
 * Spreads `limit` claim slots over providers round-robin, never exceeding a provider's remaining
 * capacity, so one provider with a deep backlog cannot starve the others of slots.
 */
export function allocateClaims(
  limit: number,
  capacity: Record<string, number>,
  excludeProviders: string[] = []
): Record<string, number> {
  const alloc: Record<string, number> = {}
  const open = Object.keys(capacity).filter((p) => capacity[p] > 0 && !excludeProviders.includes(p))
  let left = limit
  while (left > 0 && open.length > 0) {
    let progressed = false
    for (const provider of open) {
      if (left === 0) break
      if ((alloc[provider] ?? 0) < capacity[provider]) {
        alloc[provider] = (alloc[provider] ?? 0) + 1
        left--
        progressed = true
      }
    }
    if (!progressed) break
  }
  return alloc
}

export async function advanceVisibilityRuns(
  options: AdvanceOptions = {},
  deps: RunnerDeps = createDefaultDeps()
): Promise<AdvanceResult> {
  const budgetMs = options.budgetMs ?? 45_000
  const concurrency = Math.max(1, options.concurrency ?? marketingConfig.visibilityConcurrency)
  const perProvider = Math.max(1, options.perProviderConcurrency ?? marketingConfig.visibilityProviderConcurrency)
  const deadline = deps.now() + budgetMs
  const stopped = new Set<LlmProviderId>()
  const invalidated = new Set<LlmProviderId>()
  const touchedRuns = new Set<string>()
  const unfinalized = new Set<string>()
  const active = new Map<string, number>()
  const inflight = new Set<Promise<void>>()
  const result: AdvanceResult = { claimed: 0, done: 0, failed: 0 }

  try {
    await deps.sweepStuckRuns?.()
  } catch (err) {
    logger.error('Visibility sweep failed', { error: err instanceof Error ? err.name : 'unknown' })
  }

  const start = (answer: ClaimedAnswer) => {
    active.set(answer.provider, (active.get(answer.provider) ?? 0) + 1)
    const task: Promise<void> = (async () => {
      let outcome: Outcome
      if (stopped.has(answer.provider)) {
        // Provider was stopped by a sibling while this one was waiting
        await deps.release(answer.id)
        outcome = 'released'
      } else {
        try {
          outcome = await processAnswer(answer, deps, stopped, invalidated)
        } catch (err) {
          logger.error('Visibility answer processing crashed', {
            answerId: answer.id,
            error: err instanceof Error ? err.name : 'unknown',
          })
          await deps.failAnswer(answer.id, 'Unexpected error while processing this answer').catch(() => undefined)
          outcome = 'failed'
        }
      }
      if (outcome === 'done') result.done++
      else if (outcome === 'failed') result.failed++
      unfinalized.add(answer.runId)
    })().finally(() => {
      active.set(answer.provider, (active.get(answer.provider) ?? 1) - 1)
      inflight.delete(task)
    })
    inflight.add(task)
  }

  try {
    while (deps.now() < deadline) {
      let claimedNow = 0
      const free = concurrency - inflight.size
      if (free > 0) {
        const capacity: Record<string, number> = {}
        for (const id of LLM_PROVIDER_IDS) capacity[id] = perProvider - (active.get(id) ?? 0)
        const batch = await deps.claim(free, [...stopped], capacity)
        claimedNow = batch.length
        if (batch.length > 0) {
          result.claimed += batch.length
          const runIds = [...new Set(batch.map((a) => a.runId))]
          runIds.forEach((id) => touchedRuns.add(id))
          await deps.markRunsRunning(runIds)
          for (const answer of batch) start(answer)
        }
      }
      if (claimedNow === 0 && inflight.size === 0) break
      // Wait for a slot (or for work to appear) before claiming again
      if (claimedNow === 0 || inflight.size >= concurrency) await Promise.race(inflight)
      if (unfinalized.size > 0) {
        const ids = [...unfinalized]
        unfinalized.clear()
        await deps.finalizeRuns(ids)
      }
    }
  } finally {
    // Let in-flight answers finish; each is bounded by the provider call timeout
    await Promise.allSettled([...inflight])
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

    async claim(limit, excludeProviders, capacity) {
      const now = new Date()
      const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)
      const allocation = allocateClaims(limit, capacity, excludeProviders)
      // One query per provider: each walks the pending partial index (created_at, id) from the head
      // and stops after its few rows. FOR UPDATE SKIP LOCKED keeps replicas off each other's rows.
      const batches = await Promise.all(
        Object.entries(allocation).map(async ([provider, count]) => {
          const res = await db.execute<{
            id: string
            run_id: string
            prompt_id: string
            provider: LlmProviderId
            sample: number
          }>(sql`
            UPDATE ai_visibility_answer
            SET completed_at = ${sqlTimestamp(now)}
            WHERE id IN (
              SELECT a.id
              FROM ai_visibility_answer a
              WHERE a.status = 'pending'
                AND a.provider = ${provider}
                AND (a.completed_at IS NULL OR a.completed_at < ${sqlTimestamp(staleBefore)})
              ORDER BY a.created_at ASC, a.id ASC
              LIMIT ${count}
              FOR UPDATE OF a SKIP LOCKED
            )
            RETURNING id, run_id, prompt_id, provider, sample, created_at
          `)
          return res.rows
        })
      )
      return batches.flat().map((row) => ({
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
 *
 * Index-friendly: the timeout update is a range scan of the pending partial index on
 * `(created_at, id)`, and the finalize is one set-based statement.
 */
export async function sweepStuckVisibilityRuns(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - ANSWER_MAX_AGE_MS)
  await db.execute(sql`
    UPDATE ai_visibility_answer
    SET status = 'failed', error = 'Timed out', completed_at = ${sqlTimestamp(now)}
    WHERE status = 'pending' AND created_at < ${sqlTimestamp(cutoff)}
  `)
  await finalizeVisibilityRuns()
}

/**
 * SQL of the finalize statement, exported for tests. `runIds` undefined means every queued or running run.
 */
export function buildFinalizeStatement(runIds: string[] | undefined, now: Date) {
  const scope =
    runIds === undefined
      ? sql``
      : sql`AND r2.id IN (${sql.join(
          runIds.map((id) => sql`${id}`),
          sql`, `
        )})`
  return sql`
    UPDATE ai_visibility_run r
    SET status = CASE
          WHEN c.total = 0 THEN 'failed'
          WHEN c.failed = 0 THEN 'done'
          WHEN c.done = 0 THEN 'failed'
          ELSE 'partial'
        END,
        error = CASE WHEN c.total = 0 THEN 'The run has no answers to process' ELSE r.error END,
        finished_at = ${sqlTimestamp(now)}
    FROM (
      SELECT r2.id,
             count(a.id) AS total,
             count(a.id) FILTER (WHERE a.status = 'done') AS done,
             count(a.id) FILTER (WHERE a.status = 'failed') AS failed
      FROM ai_visibility_run r2
      LEFT JOIN ai_visibility_answer a ON a.run_id = r2.id
      WHERE r2.status IN ('queued', 'running')
        ${scope}
        AND NOT EXISTS (
          SELECT 1 FROM ai_visibility_answer p WHERE p.run_id = r2.id AND p.status = 'pending'
        )
      GROUP BY r2.id
    ) c
    WHERE r.id = c.id AND r.status IN ('queued', 'running')
    RETURNING r.id, r.site_id
  `
}

/**
 * Completes runs that have no pending answers left, in ONE statement: `done` when every answer
 * succeeded, `failed` when none did (or the run has no answers at all, with an explanatory error),
 * `partial` otherwise. Pass run ids to scope it (a no-op for an empty list), or nothing to cover
 * every queued/running run. Afterwards keeps only the RUN_RETENTION most recent finished runs per
 * affected site, again in one statement.
 */
export async function finalizeVisibilityRuns(runIds?: string[]): Promise<void> {
  if (runIds && runIds.length === 0) return
  const res = await db.execute<{ id: string; site_id: string }>(buildFinalizeStatement(runIds, new Date()))
  const siteIds = [...new Set(res.rows.map((r) => r.site_id))]
  if (siteIds.length > 0) await pruneFinishedRuns(siteIds)
}

/** Keeps the RUN_RETENTION newest finished runs per site (one statement for all sites); answers cascade. */
async function pruneFinishedRuns(siteIds: string[]): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM ai_visibility_run
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY site_id ORDER BY created_at DESC, id DESC) AS rn
          FROM ai_visibility_run
          WHERE site_id IN (${sql.join(
            siteIds.map((id) => sql`${id}`),
            sql`, `
          )})
            AND status IN ('done', 'partial', 'failed')
        ) ranked
        WHERE rn > ${RUN_RETENTION}
      )
    `)
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

/** Due sites started per hourly tick; with a 7 day interval this staggers ~25k sites a week */
export const SCHEDULE_BATCH_SIZE = 150

export interface ScheduleDeps {
  selectDueSites: (cutoff: Date, limit: number) => Promise<string[]>
  createRun: (input: CreateRunInput) => Promise<unknown>
}

/**
 * Sites that need a scheduled run, selected entirely in SQL so sites missing a prerequisite are
 * never fetched (and so not re-checked every hour). Mirrors the checks in `createRun`: verified
 * site, Marketing on for the team AND the product (product default is off), a brand term, an
 * active prompt, a usable (not invalid) LLM credential, and no run since `cutoff`. Never-run
 * sites come first, then the longest-waiting; LIMIT staggers the load across hourly ticks.
 */
export function buildDueSitesQuery(cutoff: Date, limit: number) {
  return sql`
    SELECT s.id
    FROM marketing_site s
    JOIN project p ON p.id = s.project_id
    JOIN team_module_settings t ON t.team_id = s.team_id
    LEFT JOIN LATERAL (
      SELECT max(r.created_at) AS last_at FROM ai_visibility_run r WHERE r.site_id = s.id
    ) lr ON true
    WHERE s.verified_at IS NOT NULL
      AND t.marketing_enabled = true
      AND p.settings ->> 'marketingEnabled' = 'true'
      AND (lr.last_at IS NULL OR lr.last_at < ${sqlTimestamp(cutoff)})
      AND EXISTS (SELECT 1 FROM marketing_term mt WHERE mt.site_id = s.id AND mt.kind = 'brand')
      AND EXISTS (SELECT 1 FROM ai_visibility_prompt ap WHERE ap.site_id = s.id AND ap.active = true)
      AND EXISTS (
        SELECT 1 FROM team_api_credential c
        WHERE c.team_id = s.team_id
          AND c.status <> 'invalid'
          AND c.provider IN (${sql.join(
            LLM_PROVIDER_IDS.map((id) => sql`${id}`),
            sql`, `
          )})
      )
    ORDER BY lr.last_at ASC NULLS FIRST, s.id ASC
    LIMIT ${limit}
  `
}

function createDefaultScheduleDeps(): ScheduleDeps {
  return {
    async selectDueSites(cutoff, limit) {
      const res = await db.execute<{ id: string }>(buildDueSitesQuery(cutoff, limit))
      return res.rows.map((r) => r.id)
    },
    createRun,
  }
}

/** Creates a `schedule` run for up to SCHEDULE_BATCH_SIZE eligible sites whose last run is older than 7 days. */
export async function scheduleWeeklyVisibilityRuns(
  now: Date = new Date(),
  deps: ScheduleDeps = createDefaultScheduleDeps()
): Promise<ScheduleResult> {
  const cutoff = new Date(now.getTime() - WEEKLY_INTERVAL_MS)
  const siteIds = await deps.selectDueSites(cutoff, SCHEDULE_BATCH_SIZE)

  const result: ScheduleResult = { created: 0, skipped: 0 }
  for (const siteId of siteIds) {
    try {
      await deps.createRun({ siteId, trigger: 'schedule' })
      result.created++
    } catch (err) {
      // A lost race (already_running) or a prerequisite that changed since the SELECT is expected
      if (!(err instanceof VisibilityRunError)) {
        logger.error('Scheduled visibility run failed to start', {
          siteId,
          error: err instanceof Error ? err.name : 'unknown',
        })
      }
      result.skipped++
    }
  }

  return result
}
