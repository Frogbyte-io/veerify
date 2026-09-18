import { describe, expect, it } from 'vitest'

import { reportingDateAt, reportingDayBounds } from '~/server/utils/support-reporting-calendar'

describe('support reporting calendar', () => {
  it('formats instants as a UTC reporting date', () => {
    expect(reportingDateAt(new Date('2026-01-02T00:30:00.000Z'), 'UTC')).toBe('2026-01-02')
  })

  it('uses the local date for UTC+13', () => {
    expect(reportingDateAt(new Date('2026-01-01T12:30:00.000Z'), 'Pacific/Apia')).toBe('2026-01-02')
    expect(reportingDayBounds('2026-01-02', 'Pacific/Apia')).toEqual({
      start: new Date('2026-01-01T11:00:00.000Z'),
      end: new Date('2026-01-02T11:00:00.000Z'),
    })
  })

  it('returns 23-hour spring-forward and 25-hour fall-back days', () => {
    const spring = reportingDayBounds('2026-03-08', 'America/New_York')
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1000)
    expect(spring).toEqual({
      start: new Date('2026-03-08T05:00:00.000Z'),
      end: new Date('2026-03-09T04:00:00.000Z'),
    })

    const fall = reportingDayBounds('2026-11-01', 'America/New_York')
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 60 * 60 * 1000)
    expect(fall).toEqual({
      start: new Date('2026-11-01T04:00:00.000Z'),
      end: new Date('2026-11-02T05:00:00.000Z'),
    })
  })

  it('accepts leap dates and rejects invalid calendar dates and timezones', () => {
    expect(reportingDayBounds('2024-02-29', 'UTC').start).toEqual(new Date('2024-02-29T00:00:00.000Z'))
    expect(() => reportingDayBounds('2023-02-29', 'UTC')).toThrow(/invalid calendar date/i)
    expect(() => reportingDayBounds('2024-13-01', 'UTC')).toThrow(/invalid calendar date/i)
    expect(() => reportingDateAt(new Date(), 'Not/AZone')).toThrow(/invalid timezone/i)
    expect(() => reportingDateAt(new Date('invalid'), 'UTC')).toThrow(/invalid instant/i)
  })

  it('supports the documented 1900 through 9998 calendar-year range', () => {
    expect(reportingDayBounds('1900-01-01', 'UTC').start).toEqual(new Date('1900-01-01T00:00:00.000Z'))
    expect(reportingDayBounds('9998-12-31', 'UTC').end).toEqual(new Date('9999-01-01T00:00:00.000Z'))
    expect(() => reportingDayBounds('1899-12-31', 'UTC')).toThrow(/year must be between/i)
    expect(() => reportingDayBounds('9999-01-01', 'UTC')).toThrow(/year must be between/i)
  })

  it('rejects a date skipped by a timezone transition', () => {
    expect(() => reportingDayBounds('2011-12-30', 'Pacific/Apia')).toThrow(/does not exist/i)
  })
})
