import { describe, expect, it } from 'vitest'
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isBusinessTime,
  type BusinessHoursConfig,
} from '~/server/utils/business-hours'

const weekdays: BusinessHoursConfig['weeklySchedule'] = {
  monday: [{ open: '09:00', close: '17:00' }],
  tuesday: [{ open: '09:00', close: '17:00' }],
  wednesday: [{ open: '09:00', close: '17:00' }],
  thursday: [{ open: '09:00', close: '17:00' }],
  friday: [{ open: '09:00', close: '17:00' }],
}

const newYorkConfig: BusinessHoursConfig = { timezone: 'America/New_York', weeklySchedule: weekdays }

describe('business-hours arithmetic', () => {
  it('rolls an after-hours Friday target into Monday business time', () => {
    const due = addBusinessMinutes(new Date('2026-08-14T21:30:00.000Z'), 240, newYorkConfig)
    expect(due.toISOString()).toBe('2026-08-17T17:00:00.000Z')
  })

  it('skips a configured local holiday', () => {
    const config = { ...newYorkConfig, holidays: ['2026-08-17'] }
    const due = addBusinessMinutes(new Date('2026-08-14T21:30:00.000Z'), 60, config)
    expect(due.toISOString()).toBe('2026-08-18T14:00:00.000Z')
  })

  it('counts real elapsed minutes across a DST spring-forward gap', () => {
    const config: BusinessHoursConfig = {
      timezone: 'America/New_York',
      weeklySchedule: { sunday: [{ open: '00:00', close: '04:00' }] },
    }
    const start = new Date('2026-03-08T05:00:00.000Z')
    const end = new Date('2026-03-08T08:00:00.000Z')
    // The 02:00–03:00 local hour does not exist, so four wall-clock hours
    // consume only three real hours.
    expect(businessMinutesBetween(start, end, config)).toBe(180)
  })

  it('supports midnight-spanning windows', () => {
    const config: BusinessHoursConfig = {
      timezone: 'UTC',
      weeklySchedule: { monday: [{ open: '22:00', close: '02:00' }] },
    }
    expect(isBusinessTime(new Date('2026-08-18T00:30:00.000Z'), config)).toBe(true)
    expect(isBusinessTime(new Date('2026-08-18T03:00:00.000Z'), config)).toBe(false)
  })

  it('accepts numeric weekday keys for persisted JSON schedules', () => {
    const config: BusinessHoursConfig = {
      timezone: 'UTC',
      weeklySchedule: { '1': [{ open: '09:00', close: '10:00' }] },
    }
    expect(isBusinessTime(new Date('2026-08-17T09:30:00.000Z'), config)).toBe(true)
  })
})
