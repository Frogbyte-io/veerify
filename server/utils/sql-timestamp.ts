import { sql } from 'drizzle-orm'

/**
 * A `timestamp` (without time zone) parameter for raw `sql` queries. Drizzle's column helpers
 * serialise dates as UTC ISO strings; a bare `Date` parameter in a raw `sql` template is instead
 * formatted by the pg driver in the process's local zone, which would shift comparisons against
 * those columns on a non-UTC server. Passing the ISO string with an explicit cast keeps both in UTC.
 */
export function sqlTimestamp(date: Date) {
  return sql`${date.toISOString()}::timestamp`
}
