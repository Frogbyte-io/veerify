import { sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingUsage } from '~/server/database/schema/marketing'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { currentPeriod } from '~/server/utils/marketing-usage'

/**
 * Rate limits for LLM-cost and outbound-fetch endpoints that hold across
 * serverless instances. The in-memory limiter (`requireRateLimit`) is per
 * instance unless `RATE_LIMIT_STORE=redis`; these counters live in
 * `marketing_usage` (metric = the key, period = the current month), so old
 * keys age out with their period and no new table is needed.
 */

/** `YYYY-MM-DD` in UTC, for per-day keys. */
export function dayStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export interface DbLimitResult {
  allowed: boolean
  remaining: number
}

/**
 * Atomically consumes one unit of `key` for the team. One upsert: the insert
 * path takes the first unit, the conflict path only increments while the
 * counter is still below `limit` (the WHERE guard), so concurrent requests can
 * never push it past the limit. No returned row means the limit was reached.
 */
export async function consumeDbLimit(teamId: string, key: string, limit: number): Promise<DbLimitResult> {
  if (!Number.isFinite(limit) || limit < 1) return { allowed: false, remaining: 0 }

  const now = new Date()
  const rows = await db
    .insert(marketingUsage)
    .values({ teamId, period: currentPeriod(now), metric: key, units: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [marketingUsage.teamId, marketingUsage.period, marketingUsage.metric],
      set: { units: sql`${marketingUsage.units} + 1`, updatedAt: now },
      setWhere: sql`${marketingUsage.units} < ${limit}`,
    })
    .returning({ units: marketingUsage.units })

  const used = rows[0] ? Number(rows[0].units) : null
  if (used === null) return { allowed: false, remaining: 0 }
  return { allowed: true, remaining: Math.max(0, limit - used) }
}

/** `consumeDbLimit` that answers 429 with `message` once the limit is reached. */
export async function requireDbLimit(
  teamId: string,
  key: string,
  limit: number,
  message: string
): Promise<DbLimitResult> {
  const result = await consumeDbLimit(teamId, key, limit)
  if (!result.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: createErrorResponse(ErrorCode.RATE_LIMITED, message),
    })
  }
  return result
}
