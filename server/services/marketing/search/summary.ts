export interface DailyRow {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface PeriodTotals {
  clicks: number
  impressions: number
  /** clicks / impressions, 0..1 */
  ctr: number
  /** Average position weighted by impressions */
  position: number
}

/**
 * Period totals from daily rows: CTR is recomputed from the sums (not averaged), and position
 * is weighted by impressions, which is how Search Console aggregates it.
 */
export function computeTotals(rows: Array<Pick<DailyRow, 'clicks' | 'impressions' | 'position'>>): PeriodTotals {
  let clicks = 0
  let impressions = 0
  let weighted = 0
  for (const row of rows) {
    clicks += row.clicks
    impressions += row.impressions
    weighted += row.position * row.impressions
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  }
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Splits rows into the `days` ending at the latest available date and the `days` before it.
 * Anchoring on the latest data date (not today) keeps both periods the same length despite
 * Search Console's reporting lag. `previous` is null when no earlier data exists.
 */
export function splitPeriods(rows: DailyRow[], days: number) {
  if (rows.length === 0) return { anchor: null, current: [] as DailyRow[], previous: null as DailyRow[] | null }
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const anchor = sorted[sorted.length - 1].date
  const currentStart = shiftDate(anchor, -(days - 1))
  const previousStart = shiftDate(anchor, -(2 * days - 1))
  const current = sorted.filter((r) => r.date >= currentStart)
  const previousRows = sorted.filter((r) => r.date >= previousStart && r.date < currentStart)
  return { anchor, current, previous: previousRows.length ? previousRows : null }
}
