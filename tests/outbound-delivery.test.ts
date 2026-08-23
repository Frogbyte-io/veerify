import { describe, expect, it, vi } from 'vitest'

import {
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

describe('processOutboundDelivery', () => {
  function claim(overrides: Partial<OutboundClaim> = {}): OutboundClaim {
    return {
      id: 'delivery-1',
      messageId: 'msg-1',
      kind: 'email',
      payload: { to: 'customer@example.com', subject: 'Re: Invoice' },
      idempotencyKey: 'idem-1',
      attemptCount: 1,
      ...overrides,
    }
  }

  it('sends and reports success without touching storage when there are no attachments', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true, message: 'sent', messageId: 'abc@domain' })
    const getObject = vi.fn()
    const onSent = vi.fn().mockResolvedValue(undefined)
    const onFailed = vi.fn().mockResolvedValue(undefined)

    const result = await processOutboundDelivery(claim(), { sendEmail, getObject, onSent, onFailed })

    expect(result).toEqual({ outcome: 'sent' })
    expect(getObject).not.toHaveBeenCalled()
    expect(onSent).toHaveBeenCalledWith('delivery-1', 'msg-1')
    expect(onFailed).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com', subject: 'Re: Invoice' })
    )
  })

  it('resolves each attachment storage key to bytes before sending', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true, message: 'sent' })
    const getObject = vi.fn().mockResolvedValue(Buffer.from('file-bytes'))
    const onSent = vi.fn().mockResolvedValue(undefined)

    const withAttachment = claim({
      payload: {
        to: 'customer@example.com',
        subject: 'Re: Invoice',
        attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', storageKey: 'support/abc.pdf' }],
      },
    })

    await processOutboundDelivery(withAttachment, { sendEmail, getObject, onSent, onFailed: vi.fn() })

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

  it('calls onFailed and never onSent when the send reports failure', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: false, message: 'rejected', error: 'SMTP rejected' })
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
