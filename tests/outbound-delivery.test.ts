import { describe, expect, it, vi } from 'vitest'

import {
  computeNextAttemptAt,
  processOutboundDelivery,
  runOutboundDeliveryWorker,
  sanitizeDeliveryError,
  type OutboundClaim,
} from '../server/utils/outbound-delivery'

describe('sanitizeDeliveryError', () => {
  it('extracts the message from an Error', () => {
    expect(sanitizeDeliveryError(new Error('SMTP connection refused'))).toBe('SMTP connection refused')
  })

  it('passes a string through unchanged when short', () => {
    expect(sanitizeDeliveryError('rejected by provider')).toBe('rejected by provider')
  })

  it('falls back to a generic message for a non-Error, non-string value', () => {
    expect(sanitizeDeliveryError({ weird: true })).toBe('Unknown outbound delivery error')
  })

  it('collapses whitespace and truncates long messages', () => {
    const long = 'x'.repeat(1000)
    const result = sanitizeDeliveryError(long)
    expect(result.length).toBeLessThanOrEqual(500)
  })
})

describe('computeNextAttemptAt', () => {
  const now = new Date('2026-08-20T10:00:00Z')

  it('uses exponential delays with deterministic midpoint jitter', () => {
    expect(computeNextAttemptAt(1, now, () => 0.5)).toEqual(new Date('2026-08-20T10:01:00Z'))
    expect(computeNextAttemptAt(2, now, () => 0.5)).toEqual(new Date('2026-08-20T10:02:00Z'))
    expect(computeNextAttemptAt(5, now, () => 0.5)).toEqual(new Date('2026-08-20T10:15:00Z'))
  })

  it('keeps jitter inside 80 to 120 percent', () => {
    expect(computeNextAttemptAt(1, now, () => 0)).toEqual(new Date('2026-08-20T10:00:48Z'))
    expect(computeNextAttemptAt(1, now, () => 1)).toEqual(new Date('2026-08-20T10:01:12Z'))
  })
})

describe('processOutboundDelivery', () => {
  function claim(overrides: Partial<OutboundClaim> = {}): OutboundClaim {
    return {
      id: 'delivery-1',
      messageId: 'msg-1',
      kind: 'email',
      payload: { to: 'customer@example.com', subject: 'Re: Invoice' },
      idempotencyKey: 'idem-1',
      attemptCount: 1,
      provider: 'postmark',
      providerAccountKey: 'server-main',
      ...overrides,
    }
  }

  it('sends and reports success without touching storage when there are no attachments', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'sent', providerMessageId: 'provider-1' })
    const getObject = vi.fn()
    const onSent = vi.fn().mockResolvedValue(undefined)
    const onFailed = vi.fn().mockResolvedValue(undefined)

    const result = await processOutboundDelivery(claim(), { sendEmail, getObject, onSent, onFailed })

    expect(result).toEqual({ outcome: 'sent' })
    expect(getObject).not.toHaveBeenCalled()
    expect(onSent).toHaveBeenCalledWith('delivery-1', 'msg-1', 1, {
      provider: 'postmark',
      providerAccountKey: 'server-main',
      providerMessageId: 'provider-1',
    })
    expect(onFailed).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: 'Re: Invoice',
        headers: {
          'X-Veerify-Idempotency-Key': 'idem-1',
          'X-PM-KeepID': 'true',
          'X-PM-Metadata-veerify-delivery-id': 'idem-1',
        },
      })
    )
  })

  it('resolves each attachment storage key to bytes before sending', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'sent' })
    const getObject = vi.fn().mockResolvedValue(Buffer.from('file-bytes'))
    const onSent = vi.fn().mockResolvedValue(undefined)

    const withAttachment = claim({
      payload: {
        to: 'customer@example.com',
        subject: 'Re: Invoice',
        attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', storageKey: 'support/abc.pdf' }],
      },
    })

    await processOutboundDelivery(withAttachment, {
      sendEmail,
      getObject,
      getAttachmentSizes: async () => [{ storageKey: 'support/abc.pdf', sizeBytes: 10 }],
      onSent,
      onFailed: vi.fn(),
    })

    expect(getObject).toHaveBeenCalledWith('support/abc.pdf')
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('file-bytes'),
          }),
        ],
      })
    )
  })

  it('rejects an oversized canonical payload before reading the first object', async () => {
    const getObject = vi.fn().mockResolvedValue(Buffer.from('should not be read'))
    const onFailed = vi.fn().mockResolvedValue(undefined)
    const result = await processOutboundDelivery(
      claim({
        payload: {
          to: 'customer@example.com',
          subject: 'Too large',
          attachments: [{ filename: 'large.bin', storageKey: 'support/large.bin' }],
        },
      }),
      {
        getObject,
        getAttachmentSizes: async () => [{ storageKey: 'support/large.bin', sizeBytes: 25 * 1024 * 1024 + 1 }],
        onFailed,
      }
    )
    expect(result).toEqual({ outcome: 'failed', error: 'Outbound attachments exceed the 25 MB per-message limit' })
    expect(getObject).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalled()
  })

  it('rejects duplicate or non-canonical references before reading storage', async () => {
    const getObject = vi.fn().mockResolvedValue(Buffer.from('should not be read'))
    const onFailed = vi.fn().mockResolvedValue(undefined)
    const result = await processOutboundDelivery(
      claim({
        payload: {
          to: 'customer@example.com',
          subject: 'Invalid',
          attachments: [
            { filename: 'a.txt', storageKey: 'support/a.txt' },
            { filename: 'a-again.txt', storageKey: 'support/a.txt' },
          ],
        },
      }),
      {
        getObject,
        getAttachmentSizes: async () => [{ storageKey: 'support/a.txt', sizeBytes: 1 }],
        onFailed,
      }
    )
    expect(result).toEqual({ outcome: 'failed', error: 'Outbound attachment references are invalid' })
    expect(getObject).not.toHaveBeenCalled()
  })

  it('calls onFailed and never onSent when the send reports failure', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ accepted: false, response: 'SMTP rejected' })
    const onSent = vi.fn().mockResolvedValue(undefined)
    const onFailed = vi.fn().mockResolvedValue(undefined)

    const result = await processOutboundDelivery(claim(), { sendEmail, getObject: vi.fn(), onSent, onFailed })

    expect(result).toEqual({ outcome: 'failed', error: 'SMTP rejected' })
    expect(onSent).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith('delivery-1', 'msg-1', 'SMTP rejected', 1)
  })

  it('calls onFailed when sendEmail throws rather than returning a failure result', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('socket hang up'))
    const onFailed = vi.fn().mockResolvedValue(undefined)

    const result = await processOutboundDelivery(claim(), { sendEmail, getObject: vi.fn(), onSent: vi.fn(), onFailed })

    expect(result).toEqual({ outcome: 'failed', error: 'socket hang up' })
    expect(onFailed).toHaveBeenCalledWith('delivery-1', 'msg-1', expect.any(Error), 1)
  })
})

describe('runOutboundDeliveryWorker', () => {
  function claim(id: string): OutboundClaim {
    return {
      id,
      messageId: `msg-${id}`,
      kind: 'email',
      payload: { to: 'customer@example.com', subject: 'Hi' },
      idempotencyKey: `idem-${id}`,
      attemptCount: 1,
    }
  }

  it('drains the queue by repeatedly claiming until nothing is left', async () => {
    const queue = [claim('a'), claim('b')]
    const claimNext = vi.fn().mockImplementation(async () => queue.shift() ?? null)
    const process = vi.fn().mockResolvedValue({ outcome: 'sent' })

    const result = await runOutboundDeliveryWorker({ claimNext, process })

    expect(result).toEqual({ processed: 2 })
    expect(process).toHaveBeenCalledTimes(2)
  })

  it('stops at maxBatch even when more deliveries are claimable', async () => {
    const claimNext = vi.fn().mockResolvedValue(claim('a'))
    const process = vi.fn().mockResolvedValue({ outcome: 'sent' })

    const result = await runOutboundDeliveryWorker({ claimNext, process, maxBatch: 3 })

    expect(result).toEqual({ processed: 3 })
    expect(claimNext).toHaveBeenCalledTimes(3)
  })

  it('continues to the next claim even when one delivery fails', async () => {
    const queue = [claim('a'), claim('b')]
    const claimNext = vi.fn().mockImplementation(async () => queue.shift() ?? null)
    const process = vi.fn().mockResolvedValue({ outcome: 'failed', error: 'boom' })

    const result = await runOutboundDeliveryWorker({ claimNext, process })

    expect(result).toEqual({ processed: 2 })
  })

  it('returns zero processed when the queue starts empty', async () => {
    const claimNext = vi.fn().mockResolvedValue(null)
    const process = vi.fn()

    const result = await runOutboundDeliveryWorker({ claimNext, process })

    expect(result).toEqual({ processed: 0 })
    expect(process).not.toHaveBeenCalled()
  })
})
