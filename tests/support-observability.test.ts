import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_SUPPORT_METRIC_STRING_LENGTH,
  SUPPORT_METRIC_NAMES,
  recordSupportMetric,
  validateSupportMetric,
  type SupportMetricName,
} from '~/server/utils/support-observability'

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))

vi.mock('~/server/utils/logger', () => ({
  createLogger: () => ({ info: logs.info, warn: logs.warn, error: vi.fn(), debug: vi.fn() }),
  logger: { info: logs.info, warn: logs.warn, error: vi.fn(), debug: vi.fn() },
}))

const { info, warn } = logs

beforeEach(() => {
  info.mockClear()
  warn.mockClear()
})

describe('support metric names', () => {
  // The names are the contract a log-based counter filters on. A rename that
  // slips through makes the counter report zero rather than error, so the whole
  // closed set is asserted literally rather than derived from the export.
  it('is exactly the set Task 16 specifies', () => {
    expect([...SUPPORT_METRIC_NAMES]).toEqual([
      'support.delivery.queued',
      'support.delivery.sent',
      'support.delivery.delivered',
      'support.delivery.failed',
      'support.delivery.bounced',
      'support.delivery.uncorrelated',
      'support.attachment.expired',
      'support.attachment.cleanup_failed',
    ])
  })

  it('accepts every declared name', () => {
    for (const name of SUPPORT_METRIC_NAMES) {
      expect(validateSupportMetric(name, { messageId: 'message-1' }).ok).toBe(true)
    }
  })

  it.each([
    'support.delivery.unknown',
    'support.delivery',
    'delivery.queued',
    'SUPPORT.DELIVERY.QUEUED',
    'support.delivery.queued ',
    '',
  ])('rejects the undeclared name %j', (name) => {
    const result = validateSupportMetric(name)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Unknown support metric name')
  })
})

describe('support metric field allowlist', () => {
  it('keeps identifiers, closed vocabularies, counts, and flags', () => {
    const result = validateSupportMetric('support.delivery.failed', {
      deliveryId: 'delivery-1',
      messageId: 'message-1',
      provider: 'postmark',
      providerAccountKey: 'account-1',
      attemptCount: 3,
      terminal: true,
      reason: 'Recipient rejected',
    })

    expect(result).toEqual({
      ok: true,
      record: {
        metric: 'support.delivery.failed',
        fields: {
          deliveryId: 'delivery-1',
          messageId: 'message-1',
          provider: 'postmark',
          providerAccountKey: 'account-1',
          attemptCount: 3,
          terminal: true,
          reason: 'Recipient rejected',
        },
      },
    })
  })

  // Support payloads carry customer email bodies, filenames, storage keys, and
  // provider credentials. Logs outlive the database and are read more widely, so
  // the boundary fails closed on anything not explicitly allowed.
  it.each([
    ['body', 'Hello, my card was charged twice'],
    ['bodyHtml', '<p>Hello</p>'],
    ['subject', 'Refund request'],
    ['filename', 'invoice.pdf'],
    ['fileName', 'invoice.pdf'],
    ['storageKey', 'support/temp/upload-1'],
    ['tempStorageKey', 'support/temp/upload-1'],
    ['finalStorageKey', 'support/final/upload-1'],
    ['recipient', 'customer@example.com'],
    ['to', 'customer@example.com'],
    ['from', 'support@example.com'],
    ['email', 'customer@example.com'],
    ['password', 'hunter2'],
    ['secret', 'shhh'],
    ['token', 'session-token'],
    ['apiKey', 'key-1'],
    ['authorization', 'Basic abc'],
    ['signature', 'sha256=abc'],
    ['error', 'connect ECONNREFUSED 10.0.0.1:587'],
    ['payload', 'anything'],
  ])('rejects the content-bearing field %s', (key, value) => {
    const result = validateSupportMetric('support.delivery.sent', { [key]: value })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(`Disallowed support metric field: ${key}`)
  })

  // The cast is the point of this test, not a workaround: `SupportMetricFields`
  // already rejects `body` at compile time, so the only way a content field
  // reaches the boundary in production is through an `any`/untyped call site.
  // This asserts the runtime half still fails closed when the type layer is
  // bypassed, and that it discards the good field along with the bad one.
  it('rejects the whole record, not just the offending field', () => {
    const result = validateSupportMetric('support.delivery.sent', {
      messageId: 'message-1',
      body: 'Customer message text',
    } as never)
    expect(result.ok).toBe(false)
  })

  it('drops null and undefined instead of rejecting them', () => {
    // Call sites pass nullable columns straight through; a missing identifier
    // adds nothing to a counter but is not a contract violation.
    const result = validateSupportMetric('support.delivery.sent', {
      messageId: 'message-1',
      providerMessageId: null,
      provider: undefined,
    })

    expect(result).toEqual({
      ok: true,
      record: { metric: 'support.delivery.sent', fields: { messageId: 'message-1' } },
    })
  })
})

describe('support metric value contract', () => {
  it('rejects an allowed key carrying a long string', () => {
    // A value this long is a payload that reached a field it should not have.
    // Rejected rather than truncated: truncating leaves part of a customer
    // message in the log.
    const result = validateSupportMetric('support.delivery.failed', {
      reason: 'x'.repeat(MAX_SUPPORT_METRIC_STRING_LENGTH + 1),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('exceeds the length limit')
  })

  it('accepts a string exactly at the length limit', () => {
    const result = validateSupportMetric('support.delivery.failed', {
      reason: 'x'.repeat(MAX_SUPPORT_METRIC_STRING_LENGTH),
    })
    expect(result.ok).toBe(true)
  })

  it.each([
    ['an object', { nested: 'value' }],
    ['an array', ['a', 'b']],
    ['a function', () => 'value'],
  ])('rejects %s in an allowed key', (_label, value) => {
    const result = validateSupportMetric('support.delivery.sent', {
      messageId: value as unknown as string,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('unsupported type')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects the non-finite count %j', (value) => {
    const result = validateSupportMetric('support.delivery.failed', { attemptCount: value })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('not a finite number')
  })
})

describe('recordSupportMetric', () => {
  it('emits the name as both the message and a field so either can be counted', () => {
    expect(recordSupportMetric('support.delivery.sent', { messageId: 'message-1', attemptCount: 1 })).toBe(true)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('support.delivery.sent', {
      metric: 'support.delivery.sent',
      messageId: 'message-1',
      attemptCount: 1,
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and emits nothing when the record is invalid', () => {
    expect(recordSupportMetric('support.delivery.sent', { body: 'secret text' } as never)).toBe(false)

    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('Rejected an invalid support metric', {
      reason: 'Disallowed support metric field: body',
    })
  })

  it('never leaks the rejected value into the warning', () => {
    recordSupportMetric('support.delivery.sent', { body: 'Customer card number 4111111111111111' } as never)

    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('4111111111111111')
  })

  // A metric must never break a delivery or cleanup pass.
  it('returns false instead of throwing when the fields object is hostile', () => {
    const hostile = {
      get messageId() {
        throw new Error('field getter exploded')
      },
    }

    expect(() => recordSupportMetric('support.delivery.sent', hostile as never)).not.toThrow()
    expect(recordSupportMetric('support.delivery.sent', hostile as never)).toBe(false)
    expect(info).not.toHaveBeenCalled()
  })

  it('accepts an omitted fields argument', () => {
    expect(recordSupportMetric('support.attachment.expired')).toBe(true)
    expect(info).toHaveBeenCalledWith('support.attachment.expired', { metric: 'support.attachment.expired' })
  })

  it('emits once per declared name', () => {
    for (const name of SUPPORT_METRIC_NAMES) {
      expect(recordSupportMetric(name as SupportMetricName, { uploadId: 'upload-1' })).toBe(true)
    }
    expect(info).toHaveBeenCalledTimes(SUPPORT_METRIC_NAMES.length)
  })
})
