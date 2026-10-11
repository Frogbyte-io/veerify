import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingUsage } from '~/server/database/schema/marketing'

/** Billing period for a date as UTC `YYYY-MM`. */
export function currentPeriod(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Adds `units` to the team's counter for this month and metric
 * (e.g. `llm:anthropic:input_tokens`, `crawl:pages`). A single atomic upsert, so
 * concurrent workers never lose increments. Non-positive or non-finite amounts
 * are ignored.
 */
export async function recordUsage(teamId: string, metric: string, units: number): Promise<void> {
  const amount = Math.round(units)
  if (!Number.isFinite(amount) || amount <= 0) return

  const now = new Date()
  await db
    .insert(marketingUsage)
    .values({ teamId, period: currentPeriod(now), metric, units: amount, updatedAt: now })
    .onConflictDoUpdate({
      target: [marketingUsage.teamId, marketingUsage.period, marketingUsage.metric],
      set: { units: sql`${marketingUsage.units} + ${amount}`, updatedAt: now },
    })
}

/** All metric counters for a team in one period (defaults to the current one). */
export async function getUsage(teamId: string, period: string = currentPeriod()): Promise<Record<string, number>> {
  const rows = await db
    .select({ metric: marketingUsage.metric, units: marketingUsage.units })
    .from(marketingUsage)
    .where(and(eq(marketingUsage.teamId, teamId), eq(marketingUsage.period, period)))

  return Object.fromEntries(
    rows
      // `ratelimit:*` rows are request counters (marketing-db-limit.ts), not billable usage
      .filter((row) => !row.metric.startsWith('ratelimit:'))
      .map((row) => [row.metric, Number(row.units)])
  )
}
