import { describe, expect, it } from 'vitest'
import { computeTotals, shiftDate, splitPeriods } from '~/server/services/marketing/search/summary'

const day = (date: string, clicks: number, impressions: number, position: number) => ({
  date,
  clicks,
  impressions,
  ctr: clicks / impressions,
  position,
})

describe('computeTotals', () => {
  it('weights position by impressions and derives ctr from sums', () => {
    const totals = computeTotals([day('2026-10-01', 10, 100, 2), day('2026-10-02', 30, 900, 10)])
    expect(totals.clicks).toBe(40)
    expect(totals.impressions).toBe(1000)
    expect(totals.ctr).toBeCloseTo(0.04)
    // (2*100 + 10*900) / 1000 = 9.2, not the plain mean 6
    expect(totals.position).toBeCloseTo(9.2)
  })

  it('does not average daily ctr', () => {
    const totals = computeTotals([day('2026-10-01', 1, 2, 1), day('2026-10-02', 0, 98, 1)])
    expect(totals.ctr).toBeCloseTo(0.01)
  })

  it('is all zeros without impressions', () => {
    expect(computeTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 })
  })
})

describe('splitPeriods', () => {
  const rows = Array.from({ length: 14 }, (_, i) => day(shiftDate('2026-10-01', i), i + 1, 100, 5))

  it('anchors on the latest date and splits into equal periods', () => {
    const { anchor, current, previous } = splitPeriods(rows, 7)
    expect(anchor).toBe('2026-10-14')
    expect(current.map((r) => r.date)).toEqual(rows.slice(7).map((r) => r.date))
    expect(previous?.map((r) => r.date)).toEqual(rows.slice(0, 7).map((r) => r.date))
  })

  it('has no previous period without earlier data', () => {
    expect(splitPeriods(rows.slice(7), 7).previous).toBeNull()
  })

  it('handles no data', () => {
    expect(splitPeriods([], 7)).toEqual({ anchor: null, current: [], previous: null })
  })
})
