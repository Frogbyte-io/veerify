import { describe, expect, it } from 'vitest'
import { resumeSlaDeadlines } from '~/server/utils/sla-timers'

describe('SLA pause/resume arithmetic', () => {
  it('shifts unexpired 24/7 deadlines and preserves an existing breach', () => {
    const result = resumeSlaDeadlines({
      deadlines: {
        firstResponseDueAt: new Date('2026-08-14T12:00:00Z'),
        nextResponseDueAt: new Date('2026-08-14T18:00:00Z'),
        resolutionDueAt: null,
      },
      pausedAt: new Date('2026-08-14T10:00:00Z'),
      resumedAt: new Date('2026-08-14T14:00:00Z'),
    })
    expect(result.firstResponseDueAt?.toISOString()).toBe('2026-08-14T16:00:00.000Z')
    expect(result.nextResponseDueAt?.toISOString()).toBe('2026-08-14T22:00:00.000Z')
    expect(result.resolutionDueAt).toBeNull()
    expect(result.pausedMinutes).toBe(240)
  })

  it('shifts only business minutes for a business-hours policy', () => {
    const result = resumeSlaDeadlines({
      deadlines: {
        firstResponseDueAt: new Date('2026-08-17T17:00:00Z'),
        nextResponseDueAt: null,
        resolutionDueAt: null,
      },
      pausedAt: new Date('2026-08-14T15:00:00Z'),
      resumedAt: new Date('2026-08-17T13:00:00Z'),
      businessHours: {
        timezone: 'UTC',
        weeklySchedule: {
          friday: [{ open: '09:00', close: '17:00' }],
          monday: [{ open: '09:00', close: '17:00' }],
        },
      },
    })
    expect(result.pausedMinutes).toBe(360)
    expect(result.firstResponseDueAt?.toISOString()).toBe('2026-08-21T15:00:00.000Z')
  })
})
