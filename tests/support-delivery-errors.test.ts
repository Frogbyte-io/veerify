import { describe, expect, it } from 'vitest'

import {
  DELIVERY_ABANDONED,
  SENDER_DOMAIN_NOT_AUTHORIZED,
  classifyDeliveryError,
  describeDeliveryFailure,
  isSenderRefusalText,
} from '../lib/support-delivery-errors'

// The production failure: Resend refused the From domain and the outbox retried it five times as a generic error.
const RESEND_550 =
  '550 The acme.example domain is not verified. Please, add and verify your domain on https://resend.com/domains'

describe('classifyDeliveryError', () => {
  it.each([
    [RESEND_550, 'sender_rejected'],
    [SENDER_DOMAIN_NOT_AUTHORIZED, 'sender_rejected'],
    [
      'sender_not_authorized: Mailgun API returned 400: The sender domain is not verified for this project.',
      'sender_rejected',
    ],
    ['Mailgun API returned 400: Domain mail.acme.example is not verified for sending yet.', 'sender_rejected'],
    ['553 5.7.1 Sender address rejected: not owned by user', 'sender_rejected'],
    ['550 5.1.1 <nobody@example.org>: Recipient address rejected: User unknown', 'recipient_rejected'],
    ['550 5.1.1 The email account that you tried to reach does not exist', 'recipient_rejected'],
    ['552 5.2.2 The email account that you tried to reach is over quota', 'mailbox_full'],
    ['452 4.2.2 Mailbox full', 'mailbox_full'],
    ['Connection timeout', 'provider_unavailable'],
    ['connect ECONNREFUSED 127.0.0.1:587', 'provider_unavailable'],
    ['Mailgun API returned 503: no message', 'provider_unavailable'],
    ['421 4.7.0 Try again later', 'provider_unavailable'],
    ['Invalid login: 535 Authentication failed', 'configuration'],
    ['SUPPORT_SEND_TRANSPORT must be "smtp" or "mailgun", not "x"', 'configuration'],
    ['Mailgun API returned 401 (unauthenticated): Forbidden', 'configuration'],
    [DELIVERY_ABANDONED, 'abandoned'],
    ['something odd happened', 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
  ])('%s -> %s', (error, reason) => {
    expect(classifyDeliveryError(error)).toBe(reason)
  })

  it('returns a plain sentence for every reason', () => {
    expect(describeDeliveryFailure(RESEND_550)).toEqual({
      reason: 'sender_rejected',
      message: 'The mail provider refused the From address: its domain is not verified for sending.',
    })
    expect(describeDeliveryFailure('weird').message).toBe('The reply could not be sent.')
  })
})

describe('isSenderRefusalText', () => {
  it('recognizes Resend and Frogmail sender refusals', () => {
    expect(isSenderRefusalText(RESEND_550)).toBe(true)
    expect(isSenderRefusalText('The sender domain is not verified for this project.')).toBe(true)
    expect(
      isSenderRefusalText('The sender domain acme.example is verified by another project, which owns sending for it.')
    ).toBe(true)
    expect(isSenderRefusalText('Domain not found: acme.example')).toBe(true)
  })

  it('leaves recipient and transient failures alone', () => {
    expect(isSenderRefusalText('550 5.1.1 user unknown')).toBe(false)
    expect(isSenderRefusalText('421 busy, try again later')).toBe(false)
    expect(isSenderRefusalText('The recipient domain example.org has no MX')).toBe(false)
  })
})
