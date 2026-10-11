/**
 * Budget reservations for team-key LLM calls (no schema change).
 *
 * Reading the month's spend before a call and recording it after lets concurrent calls all pass the
 * check and overshoot the cap. Instead every capped call first reserves an upper-bound cost:
 *
 *   `llm:<provider>:reserved_usd_micros`  in-flight reservations (a counter in `marketing_usage`)
 *   `llm:<provider>:cost_usd_micros`      settled spend (unchanged)
 *
 * `reserveBudget` increments the reserved counter only if `spent + reserved + amount <= cap`.
 * `settleBudget` moves the reservation into spend using the call's actual cost; `releaseBudget`
 * drops it when the provider was never (successfully) used.
 *
 * Decisions and trade-offs
 * - No cap: nothing is reserved (no cap to enforce, no write contention). Callers hold
 *   `heldMicros(amount, cap)` which is 0 in that case, and settle with that held amount.
 * - Reservations are upper bounds (output cap, searches at their fee, input generously sized), so
 *   near the cap a call can be refused although its real cost would have fit. The provider invoice
 *   stays the source of truth.
 * - If a call costs more than reserved (e.g. Anthropic `pause_turn` continuations), settle books
 *   the actual cost, so the cap can still be exceeded by that difference.
 * - A crash between reserve and settle leaks the reservation. There is no per-reservation table, so
 *   `resetStaleReservations` (hourly, from the visibility schedule task) zeroes reserved counters
 *   not touched for 15 minutes. A leak therefore blocks at most one call's upper bound, and only
 *   until the counter has been quiet for 15 minutes and the next hourly run; a busy team's leak
 *   lingers until it is quiet. Live reservations last seconds, so zeroing a quiet counter cannot
 *   drop a real one; a late settle after a reset is clamped at zero.
 */

import { sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { estimateCostUsdMicros, LLM_CALL_LIMITS, LLM_MODELS } from '~/server/services/llm/models'
import type { LlmProviderId } from '~/server/services/llm/types'
import { currentPeriod } from '~/server/utils/marketing-usage'

export const RESERVATION_STALE_MS = 15 * 60 * 1000
/** Conservative chars-per-token when sizing prompts */
const CHARS_PER_TOKEN = 3
const MIN_INPUT_TOKENS = 1000
/** Extra input tokens a web search can add to the context (results are read by the model) */
const SEARCH_RESULT_INPUT_TOKENS = 3000

export const reservedMetric = (provider: string) => `llm:${provider}:reserved_usd_micros`
export const costMetric = (provider: string) => `llm:${provider}:cost_usd_micros`

/** Upper-bound cost in micro-USD of one call at its token and search limits. */
export function estimateMaxCostUsdMicros(
  provider: LlmProviderId,
  model: string,
  limits: { maxInputTokens: number; maxOutputTokens: number; maxSearches?: number }
): number {
  return estimateCostUsdMicros(provider, model, null, {
    inputTokens: limits.maxInputTokens,
    outputTokens: limits.maxOutputTokens,
    webSearchRequests: limits.maxSearches ?? 0,
  })
}

/** Input tokens for text of this length: chars / 3, never below 1000. */
export function estimateInputTokens(text: string): number {
  return Math.max(MIN_INPUT_TOKENS, Math.ceil(text.length / CHARS_PER_TOKEN))
}

/** Reservation for one visibility answer (web search) plus the extraction call that follows it. */
export function estimateVisibilityReservation(
  provider: LlmProviderId,
  answerModel: string,
  extractModel: string,
  promptText: string,
  extractionSystemText: string
): number {
  const limits = LLM_CALL_LIMITS[provider]
  const answer = estimateMaxCostUsdMicros(provider, answerModel, {
    maxInputTokens: estimateInputTokens(promptText) + limits.maxSearches * SEARCH_RESULT_INPUT_TOKENS,
    maxOutputTokens: limits.answerMaxOutputTokens,
    maxSearches: limits.maxSearches,
  })
  // The extraction input is the answer text, which is at most the answer output cap
  const extract = estimateMaxCostUsdMicros(provider, extractModel, {
    maxInputTokens: estimateInputTokens(extractionSystemText) + limits.answerMaxOutputTokens,
    maxOutputTokens: limits.extractMaxOutputTokens,
  })
  return answer + extract
}

/** Reservation for a `callTeamLlm` request on the provider's extraction model. */
export function estimateTeamCallReservation(
  provider: LlmProviderId,
  request: { system: string; input: string; schema: Record<string, unknown> }
): number {
  return estimateMaxCostUsdMicros(provider, LLM_MODELS[provider].extract, {
    maxInputTokens: estimateInputTokens(request.system + request.input + JSON.stringify(request.schema)),
    maxOutputTokens: LLM_CALL_LIMITS[provider].extractMaxOutputTokens,
  })
}

/** Amount actually held for a reservation: nothing is held when the key has no cap. */
export function heldMicros(amountMicros: number, capCents: number | null): number {
  return capCents == null ? 0 : Math.max(0, Math.ceil(amountMicros))
}

/** The guard's arithmetic, mirrored from the SQL for tests and documentation. */
export function fitsBudget(spent: number, reserved: number, amount: number, capCents: number): boolean {
  return spent + reserved + amount <= capCents * 10_000
}

/**
 * Reserves `amountMicros` for the provider this month if `spent + reserved + amount <= cap`.
 * Resolves false when the cap would be exceeded. No cap (null) always succeeds without writing.
 *
 * Two statements in one transaction. The first upserts the reserved row without changing it, which
 * takes its row lock. The second is the guard: a single UPDATE whose WHERE compares
 * `reserved + amount + spent` with the cap, and which only matches (and so only increments) when
 * the sum fits. Because the lock is taken first, the guard statement's snapshot is new enough to see
 * any concurrent settle (which holds the same lock until commit) in both counters, and concurrent
 * reservations serialize on the row, each seeing the previous one.
 */
export async function reserveBudget(
  teamId: string,
  provider: string,
  amountMicros: number,
  capCents: number | null
): Promise<boolean> {
  if (capCents == null) return true
  const amount = Math.max(0, Math.ceil(amountMicros))
  const capMicros = capCents * 10_000
  const period = currentPeriod()
  const reserved = reservedMetric(provider)
  const spent = costMetric(provider)

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing_usage (team_id, period, metric, units, updated_at)
      VALUES (${teamId}, ${period}, ${reserved}, 0, now())
      ON CONFLICT (team_id, period, metric) DO UPDATE SET units = marketing_usage.units
    `)
    const result = await tx.execute(sql`
      UPDATE marketing_usage
      SET units = units + ${amount}::bigint, updated_at = now()
      WHERE team_id = ${teamId} AND period = ${period} AND metric = ${reserved}
        AND units + ${amount}::bigint + COALESCE((
          SELECT c.units FROM marketing_usage c
          WHERE c.team_id = ${teamId} AND c.period = ${period} AND c.metric = ${spent}
        ), 0) <= ${capMicros}::bigint
      RETURNING units
    `)
    return result.rows.length > 0
  })
}

/**
 * Ends a reservation: removes `reservedMicros` from the reserved counter and adds `actualMicros`
 * to spend, atomically. Pass the amount `reserveBudget` actually held (0 when uncapped).
 */
export async function settleBudget(
  teamId: string,
  provider: string,
  reservedMicros: number,
  actualMicros: number
): Promise<void> {
  const held = Math.max(0, Math.ceil(reservedMicros))
  const actual = Math.max(0, Math.ceil(actualMicros))
  if (held === 0 && actual === 0) return
  const period = currentPeriod()

  await db.transaction(async (tx) => {
    // Same lock order as reserveBudget: reserved row first
    if (held > 0) {
      await tx.execute(sql`
        UPDATE marketing_usage
        SET units = GREATEST(units - ${held}::bigint, 0), updated_at = now()
        WHERE team_id = ${teamId} AND period = ${period} AND metric = ${reservedMetric(provider)}
      `)
    }
    if (actual > 0) {
      await tx.execute(sql`
        INSERT INTO marketing_usage (team_id, period, metric, units, updated_at)
        VALUES (${teamId}, ${period}, ${costMetric(provider)}, ${actual}::bigint, now())
        ON CONFLICT (team_id, period, metric)
        DO UPDATE SET units = marketing_usage.units + ${actual}::bigint, updated_at = now()
      `)
    }
  })
}

/** Drops a reservation when the provider was not used (no key, validation failure, error before billing). */
export function releaseBudget(teamId: string, provider: string, reservedMicros: number): Promise<void> {
  return settleBudget(teamId, provider, reservedMicros, 0)
}

/**
 * Zeroes reserved counters untouched for `RESERVATION_STALE_MS`, recovering reservations leaked by
 * a crash between reserve and settle. Returns the number of counters reset.
 */
export async function resetStaleReservations(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RESERVATION_STALE_MS)
  const result = await db.execute(sql`
    UPDATE marketing_usage
    SET units = 0
    WHERE metric LIKE 'llm:%:reserved_usd_micros' AND units > 0 AND updated_at < ${cutoff.toISOString()}::timestamptz
    RETURNING team_id
  `)
  return result.rows.length
}
