import { and, eq, notLike, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingUsage } from '~/server/database/schema/marketing'

/** Billing period for a date as UTC `YYYY-MM`. */
export function currentPeriod(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Adds `units` to the workspace's counter for this month and metric
 * (e.g. `llm:anthropic:input_tokens`, `crawl:pages`). A single atomic upsert, so
 * concurrent workers never lose increments. Non-positive or non-finite amounts
 * are ignored.
 */
export async function recordUsage(organizationId: string, metric: string, units: number): Promise<void> {
  const amount = Math.round(units)
  if (!Number.isFinite(amount) || amount <= 0) return

  const now = new Date()
  await db
    .insert(marketingUsage)
    .values({ organizationId, period: currentPeriod(now), metric, units: amount, updatedAt: now })
    .onConflictDoUpdate({
      target: [marketingUsage.organizationId, marketingUsage.period, marketingUsage.metric],
      set: { units: sql`${marketingUsage.units} + ${amount}`, updatedAt: now },
    })
}

/** All metric counters for a workspace in one period (defaults to the current one). */
export async function getUsage(
  organizationId: string,
  period: string = currentPeriod()
): Promise<Record<string, number>> {
  const rows = await db
    .select({ metric: marketingUsage.metric, units: marketingUsage.units })
    .from(marketingUsage)
    .where(
      and(
        eq(marketingUsage.organizationId, organizationId),
        eq(marketingUsage.period, period),
        // `ratelimit:*` rows are request counters (marketing-db-limit.ts), not billable usage
        // `ratelimit:*` rows are request counters (marketing-db-limit.ts) and `digest:<date>` rows the
        // mentions-digest claim ledger (mentions/digest.ts); neither is billable usage
        notLike(marketingUsage.metric, 'ratelimit:%'),
        notLike(marketingUsage.metric, 'digest:%')
      )
    )

  return Object.fromEntries(rows.map((row) => [row.metric, Number(row.units)]))
}
