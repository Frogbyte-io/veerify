import { describe, expect, it } from 'vitest'
import { calculateSlaDueDates, matchesSlaPolicy, selectSlaPolicy, selectSlaTarget } from '~/server/utils/sla'

const context = {
  inboxId: 'inbox-a',
  priority: 'high',
  tagIds: ['billing'],
  companyId: 'company-a',
}

describe('SLA policy matching', () => {
  it('matches all scalar conditions and any configured tag', () => {
    expect(
      matchesSlaPolicy(
        {
          conditions: {
            inboxIds: ['inbox-a'],
            priorities: ['high'],
            tagIds: ['billing', 'vip'],
            companyIds: ['company-a'],
          },
        },
        context
      )
    ).toBe(true)
    expect(matchesSlaPolicy({ conditions: { priorities: ['urgent'] } }, context)).toBe(false)
  })

  it('uses sort order for conditional policies and default as the final fallback', () => {
    const policies = [
      { id: 'default', conditions: {}, isDefault: true, sortOrder: 0 },
      { id: 'later', conditions: { inboxIds: ['inbox-a'] }, isDefault: false, sortOrder: 20 },
      { id: 'earlier', conditions: { inboxIds: ['inbox-a'] }, isDefault: false, sortOrder: 10 },
    ]
    expect(selectSlaPolicy(policies, context)?.id).toBe('earlier')
    expect(selectSlaPolicy(policies, { ...context, inboxId: 'other' })?.id).toBe('default')
    expect(selectSlaPolicy(policies.slice(1), { ...context, inboxId: 'other' })).toBeNull()
  })

  it('prefers an exact priority target over the catch-all target', () => {
    const targets = [
      { metric: 'first_response', priority: null, targetMinutes: 240 },
      { metric: 'first_response', priority: 'urgent', targetMinutes: 30 },
    ]
    expect(selectSlaTarget(targets, 'first_response', 'urgent')?.targetMinutes).toBe(30)
    expect(selectSlaTarget(targets, 'first_response', 'normal')?.targetMinutes).toBe(240)
  })
})

describe('SLA due dates', () => {
  it('calculates wall-clock deadlines for a 24/7 policy', () => {
    const due = calculateSlaDueDates(
      new Date('2026-08-14T21:30:00.000Z'),
      [
        { metric: 'first_response', priority: null, targetMinutes: 240 },
        { metric: 'resolution', priority: null, targetMinutes: 1440 },
      ],
      'normal'
    )
    expect(due.first_response?.toISOString()).toBe('2026-08-15T01:30:00.000Z')
    expect(due.resolution?.toISOString()).toBe('2026-08-15T21:30:00.000Z')
    expect(due.next_response).toBeNull()
  })

  it('can calculate a next-response deadline after the first response', () => {
    const due = calculateSlaDueDates(
      new Date('2026-08-14T21:30:00.000Z'),
      [{ metric: 'next_response', priority: null, targetMinutes: 60 }],
      'normal'
    )
    expect(due.next_response?.toISOString()).toBe('2026-08-14T22:30:00.000Z')
  })

  it('calculates business-hours deadlines from the same start instant', () => {
    const due = calculateSlaDueDates(
      new Date('2026-08-14T21:30:00.000Z'),
      [{ metric: 'first_response', priority: null, targetMinutes: 240 }],
      'normal',
      {
        timezone: 'America/New_York',
        weeklySchedule: {
          monday: [{ open: '09:00', close: '17:00' }],
          tuesday: [{ open: '09:00', close: '17:00' }],
          wednesday: [{ open: '09:00', close: '17:00' }],
          thursday: [{ open: '09:00', close: '17:00' }],
          friday: [{ open: '09:00', close: '17:00' }],
        },
      }
    )
    expect(due.first_response?.toISOString()).toBe('2026-08-17T17:00:00.000Z')
  })
})
