import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isValidCronExpression } from '../server/services/scheduler/cron'
import { verifyCronSecret } from '../server/services/scheduler/cron-auth'
import {
  clearScheduledTasks,
  defineScheduledTask,
  getScheduledTask,
  listScheduledTasks,
} from '../server/services/scheduler/registry'

describe('isValidCronExpression', () => {
  it('accepts standard 5-field expressions', () => {
    expect(isValidCronExpression('* * * * *')).toBe(true)
    expect(isValidCronExpression('*/15 * * * *')).toBe(true)
    expect(isValidCronExpression('0 3 * * *')).toBe(true)
    expect(isValidCronExpression('0 9-17 * * 1-5')).toBe(true)
    expect(isValidCronExpression('0,30 * * * *')).toBe(true)
    expect(isValidCronExpression('*/5 8-18/2 1,15 1-6 0,7')).toBe(true)
  })

  it('rejects wrong field counts', () => {
    expect(isValidCronExpression('* * * *')).toBe(false)
    expect(isValidCronExpression('* * * * * *')).toBe(false)
    expect(isValidCronExpression('')).toBe(false)
    expect(isValidCronExpression('   ')).toBe(false)
  })

  it('rejects out-of-range values per field', () => {
    expect(isValidCronExpression('60 * * * *')).toBe(false) // minute max 59
    expect(isValidCronExpression('* 24 * * *')).toBe(false) // hour max 23
    expect(isValidCronExpression('* * 32 * *')).toBe(false) // day-of-month max 31
    expect(isValidCronExpression('* * 0 * *')).toBe(false) // day-of-month min 1
    expect(isValidCronExpression('* * * 13 *')).toBe(false) // month max 12
    expect(isValidCronExpression('* * * * 8')).toBe(false) // day-of-week max 7
  })

  it('rejects malformed ranges and steps', () => {
    expect(isValidCronExpression('5-1 * * * *')).toBe(false) // reversed range
    expect(isValidCronExpression('*/0 * * * *')).toBe(false) // zero step
    expect(isValidCronExpression('*/abc * * * *')).toBe(false)
    expect(isValidCronExpression('a * * * *')).toBe(false)
    expect(isValidCronExpression(', * * * *')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidCronExpression(null)).toBe(false)
    expect(isValidCronExpression(undefined)).toBe(false)
    expect(isValidCronExpression(123)).toBe(false)
  })
})

describe('defineScheduledTask registration', () => {
  beforeEach(() => {
    clearScheduledTasks()
  })

  afterEach(() => {
    clearScheduledTasks()
  })

  it('registers a task and makes it retrievable by name', () => {
    const handler = vi.fn()
    const definition = defineScheduledTask('test:one', '*/5 * * * *', handler)

    expect(definition).toEqual({ name: 'test:one', cron: '*/5 * * * *', handler })
    expect(getScheduledTask('test:one')).toBe(definition)
    expect(listScheduledTasks()).toEqual([definition])
  })

  it('trims the task name and cron expression', () => {
    const handler = vi.fn()
    defineScheduledTask('  test:trim  ', '  * * * * *  ', handler)

    const task = getScheduledTask('test:trim')
    expect(task?.name).toBe('test:trim')
    expect(task?.cron).toBe('* * * * *')
  })

  it('rejects a duplicate task name', () => {
    defineScheduledTask('test:dup', '* * * * *', vi.fn())

    expect(() => defineScheduledTask('test:dup', '0 0 * * *', vi.fn())).toThrow(/already registered/)
    // The original registration must survive a rejected duplicate attempt.
    expect(getScheduledTask('test:dup')?.cron).toBe('* * * * *')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(() => defineScheduledTask('', '* * * * *', vi.fn())).toThrow(/name/)
    expect(() => defineScheduledTask('   ', '* * * * *', vi.fn())).toThrow(/name/)
  })

  it('rejects an invalid cron expression', () => {
    expect(() => defineScheduledTask('test:badcron', 'not a cron', vi.fn())).toThrow(/valid 5-field cron/)
    expect(() => defineScheduledTask('test:badcron2', '', vi.fn())).toThrow(/valid 5-field cron/)
  })

  it('rejects a non-function handler', () => {
    // @ts-expect-error deliberately passing the wrong type
    expect(() => defineScheduledTask('test:badhandler', '* * * * *', 'not a function')).toThrow(/handler/)
  })

  it('clearScheduledTasks empties the registry', () => {
    defineScheduledTask('test:clear', '* * * * *', vi.fn())
    expect(listScheduledTasks()).toHaveLength(1)

    clearScheduledTasks()

    expect(listScheduledTasks()).toHaveLength(0)
    expect(getScheduledTask('test:clear')).toBeUndefined()
  })
})

describe('verifyCronSecret', () => {
  it('accepts a matching bearer token', () => {
    expect(verifyCronSecret('Bearer sekrit-value', 'sekrit-value')).toBe(true)
  })

  it('accepts a matching token without the Bearer prefix', () => {
    expect(verifyCronSecret('sekrit-value', 'sekrit-value')).toBe(true)
  })

  it('rejects a mismatched token', () => {
    expect(verifyCronSecret('Bearer wrong', 'sekrit-value')).toBe(false)
  })

  it('rejects when the header is missing', () => {
    expect(verifyCronSecret(null, 'sekrit-value')).toBe(false)
    expect(verifyCronSecret(undefined, 'sekrit-value')).toBe(false)
    expect(verifyCronSecret('', 'sekrit-value')).toBe(false)
  })

  it('fails closed when the configured secret is missing or empty', () => {
    // A misconfigured deployment must never fall back to "allow everything".
    expect(verifyCronSecret('Bearer anything', undefined)).toBe(false)
    expect(verifyCronSecret('Bearer anything', '')).toBe(false)
    expect(verifyCronSecret('Bearer anything', '   ')).toBe(false)
  })

  it('rejects a token that differs only in length', () => {
    expect(verifyCronSecret('Bearer sekrit-value-extra', 'sekrit-value')).toBe(false)
    expect(verifyCronSecret('Bearer sekrit', 'sekrit-value')).toBe(false)
  })
})
