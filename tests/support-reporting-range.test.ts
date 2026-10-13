import { describe, expect, it } from 'vitest'

import { resolveReportingRange } from '~/server/utils/support-reporting-range'

const NOW = new Date('2026-03-10T12:00:00.000Z')

describe('resolveReportingRange', () => {
  it('resolves an inclusive local date range to half-open UTC boundaries', () => {
    const range = resolveReportingRange({
      from: '2026-03-08',
      to: '2026-03-08',
      timezone: 'America/New_York',
      now: NOW,
    })

    expect(range).toMatchObject({
      from: '2026-03-08',
      to: '2026-03-08',
      timezone: 'America/New_York',
      start: new Date('2026-03-08T05:00:00.000Z'),
      end: new Date('2026-03-09T04:00:00.000Z'),
    })
    expect(range.days).toEqual([
      {
        date: '2026-03-08',
        start: new Date('2026-03-08T05:00:00.000Z'),
        end: new Date('2026-03-09T04:00:00.000Z'),
      },
    ])
  })

  it('rejects timestamps, impossible dates, and invalid years', () => {
    expect(() => resolveReportingRange({ from: '2026-03-08T00:00:00Z', timezone: 'UTC', now: NOW })).toThrow(RangeError)
    expect(() => resolveReportingRange({ from: '2023-02-29', timezone: 'UTC', now: NOW })).toThrow(RangeError)
    expect(() => resolveReportingRange({ from: '2024-02-30', timezone: 'UTC', now: NOW })).toThrow(RangeError)
    expect(() => resolveReportingRange({ from: '1899-12-31', timezone: 'UTC', now: NOW })).toThrow(RangeError)
    expect(() => resolveReportingRange({ from: '9999-01-01', timezone: 'UTC', now: NOW })).toThrow(RangeError)
  })

  it('rejects reversed ranges, invalid timezones, and invalid now values', () => {
    expect(() => resolveReportingRange({ from: '2026-03-11', to: '2026-03-10', timezone: 'UTC', now: NOW })).toThrow(
      RangeError
    )
    expect(() => resolveReportingRange({ timezone: 'Not/AZone', now: NOW })).toThrow(RangeError)
    expect(() => resolveReportingRange({ timezone: 'UTC', now: new Date('invalid') })).toThrow(RangeError)
  })

  it('defaults to the local today and the preceding 29 civil dates', () => {
    const range = resolveReportingRange({ timezone: 'America/New_York', now: NOW })

    expect(range.from).toBe('2026-02-09')
    expect(range.to).toBe('2026-03-10')
    expect(range.end).toEqual(new Date('2026-03-11T04:00:00.000Z'))
    expect(range.days).toHaveLength(29 + 1)
    expect(range.days[0]?.date).toBe('2026-02-09')
    expect(range.days.at(-1)?.date).toBe('2026-03-10')
  })

  it('defaults a missing to endpoint to local today', () => {
    const range = resolveReportingRange({ from: '2026-03-01', timezone: 'America/New_York', now: NOW })

    expect(range.to).toBe('2026-03-10')
    expect(range.from).toBe('2026-03-01')
  })

  it('defaults a missing from endpoint to 29 civil dates before an explicit to', () => {
    const range = resolveReportingRange({ to: '2026-03-01', timezone: 'America/New_York', now: NOW })

    expect(range.from).toBe('2026-01-31')
    expect(range.to).toBe('2026-03-01')
  })

  it('rejects a future end date relative to the local today', () => {
    expect(() => resolveReportingRange({ to: '2026-03-11', timezone: 'America/New_York', now: NOW })).toThrow(
      RangeError
    )
  })

  it('accepts 366 inclusive labels and rejects 367', () => {
    expect(
      resolveReportingRange({
        from: '2024-01-01',
        to: '2024-12-31',
        timezone: 'UTC',
        now: new Date('2025-01-01T00:00:00.000Z'),
      }).days
    ).toHaveLength(366)
    expect(() =>
      resolveReportingRange({ from: '2023-01-01', to: '2023-12-31', timezone: 'UTC', now: NOW })
    ).not.toThrow()
    expect(() => resolveReportingRange({ from: '2023-01-01', to: '2024-01-02', timezone: 'UTC', now: NOW })).toThrow(
      RangeError
    )
  })

  it('uses civil labels for UTC+13 and preserves 23- and 25-hour days', () => {
    const apia = resolveReportingRange({
      from: '2026-01-02',
      to: '2026-01-02',
      timezone: 'Pacific/Apia',
      now: NOW,
    })
    expect(apia.start).toEqual(new Date('2026-01-01T11:00:00.000Z'))
    expect(apia.end).toEqual(new Date('2026-01-02T11:00:00.000Z'))

    const spring = resolveReportingRange({
      from: '2026-03-08',
      to: '2026-03-08',
      timezone: 'America/New_York',
      now: NOW,
    })
    const fall = resolveReportingRange({
      from: '2026-11-01',
      to: '2026-11-01',
      timezone: 'America/New_York',
      now: new Date('2026-11-02T12:00:00.000Z'),
    })
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1000)
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 60 * 60 * 1000)
  })

  it('rejects an absent Apia endpoint but omits an absent interior date', () => {
    expect(() =>
      resolveReportingRange({ from: '2011-12-30', to: '2011-12-30', timezone: 'Pacific/Apia', now: NOW })
    ).toThrow(/does not exist/i)

    const range = resolveReportingRange({
      from: '2011-12-29',
      to: '2011-12-31',
      timezone: 'Pacific/Apia',
      now: NOW,
    })
    expect(range.days.map((day) => day.date)).toEqual(['2011-12-29', '2011-12-31'])
    expect(range.start).toEqual(new Date('2011-12-29T10:00:00.000Z'))
    expect(range.end).toEqual(new Date('2011-12-31T10:00:00.000Z'))
  })

  it('rejects an inferred endpoint when the default from date is absent', () => {
    expect(() => resolveReportingRange({ to: '2012-01-28', timezone: 'Pacific/Apia', now: NOW })).toThrow(
      /does not exist/i
    )
  })
})
