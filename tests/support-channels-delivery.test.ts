import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { PostmarkChannelDriver } from '../server/services/support-channels/webhook/postmark'
import { MailgunChannelDriver } from '../server/services/support-channels/webhook/mailgun'

/**
 * Fixtures are trimmed captures of documented provider delivery/bounce
 * webhook shapes, following the same convention as `support-channels.test.ts`
 * for inbound - so a provider changing its field names fails here rather
 * than silently producing an event nothing acts on.
 *
 * Correlation metadata is provider identity, not RFC Message-ID. These
 * fixtures pin the provider/account/event fields and durable outbox key so a
 * provider payload change cannot silently reintroduce RFC-ID matching.
 */

const POSTMARK_DELIVERY = {
  RecordType: 'Delivery',
  MessageID: 'reply-abc@acme.com',
  Recipient: 'Customer@Example.com',
  DeliveredAt: '2026-08-20T10:00:00Z',
  Details: 'smtp;250 2.0.0 OK',
  ServerID: 42,
  Metadata: { 'veerify-delivery-id': 'delivery-1' },
}

const POSTMARK_HARD_BOUNCE = {
  RecordType: 'Bounce',
  ID: 692560173,
  Type: 'HardBounce',
  TypeCode: 1,
  MessageID: 'reply-abc@acme.com',
  Email: 'Customer@Example.com',
  Description: 'The server was unable to deliver your message',
}

const POSTMARK_SOFT_BOUNCE = { ...POSTMARK_HARD_BOUNCE, ID: 999, Type: 'SoftBounce' }

const POSTMARK_OPEN = {
  RecordType: 'Open',
  MessageID: 'reply-abc@acme.com',
  Recipient: 'Customer@Example.com',
}

describe('PostmarkChannelDriver delivery events', () => {
  const driver = new PostmarkChannelDriver({ user: 'u', password: 'p', accountKey: 'postmark-account' })

  it('parses a Delivery record as delivered, with no bounceType', () => {
    const event = driver.parseDeliveryEvent(POSTMARK_DELIVERY)
    expect(event).toEqual({
      providerEventId: 'Delivery:reply-abc@acme.com:customer@example.com:2026-08-20T10:00:00Z',
      providerAccountKey: '42',
      correlationKey: 'delivery-1',
      providerMessageId: 'reply-abc@acme.com',
      // Postmark's MessageID is its own id, not an RFC Message-ID.
      rfcMessageId: null,
      recordType: 'delivered',
      recipient: 'customer@example.com',
      occurredAt: new Date('2026-08-20T10:00:00Z'),
      error: null,
      bounceType: null,
      description: null,
    })
  })

  it('parses a HardBounce as bounced/hard, with the description', () => {
    const event = driver.parseDeliveryEvent(POSTMARK_HARD_BOUNCE)
    expect(event.recordType).toBe('bounced')
    expect(event.bounceType).toBe('hard')
    expect(event.description).toBe('The server was unable to deliver your message')
  })

  it('parses a SoftBounce as bounced/soft', () => {
    const event = driver.parseDeliveryEvent(POSTMARK_SOFT_BOUNCE)
    expect(event.bounceType).toBe('soft')
  })

  it('classifies an unrecognized bounce Type as hard, not soft', () => {
    const event = driver.parseDeliveryEvent({ ...POSTMARK_HARD_BOUNCE, Type: 'SomeFutureBounceType' })
    // design.md: silent delivery failure is worse than a visible error - an
    // ambiguous bounce record must surface, not be swallowed as soft.
    expect(event.bounceType).toBe('hard')
  })

  it('parses an Open record with its own recordType, no bounceType', () => {
    const event = driver.parseDeliveryEvent(POSTMARK_OPEN)
    expect(event.recordType).toBe('opened')
    expect(event.bounceType).toBeNull()
  })

  it('keys a Bounce event by its own numeric ID', () => {
    expect(driver.extractDeliveryEventId(POSTMARK_HARD_BOUNCE)).toBe('postmark-bounce-692560173')
  })

  it('keys a non-Bounce event by a composite of record type, message id, and recipient', () => {
    expect(driver.extractDeliveryEventId(POSTMARK_DELIVERY)).toBe(
      'Delivery:reply-abc@acme.com:customer@example.com:2026-08-20T10:00:00Z'
    )
  })

  it('returns null for a payload with neither a Bounce ID nor enough to compose a key', () => {
    expect(driver.extractDeliveryEventId({ RecordType: 'Delivery' })).toBeNull()
  })
})

const MAILGUN_SIGNING_KEY = 'test-signing-key'

function mailgunEventFixture(eventData: Record<string, unknown>) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const token = 'tok-delivery'
  const signature = createHmac('sha256', MAILGUN_SIGNING_KEY)
    .update(timestamp + token)
    .digest('hex')

  return {
    signature: { timestamp, token, signature },
    'event-data': { id: 'mg-event-1', ...eventData },
  }
}

const MAILGUN_DELIVERED = mailgunEventFixture({
  event: 'delivered',
  timestamp: 1788256800,
  domain: { name: 'MG.Acme.com' },
  'user-variables': { 'veerify-delivery-id': 'delivery-1' },
  recipient: 'Customer@Example.com',
  message: { headers: { 'message-id': '<reply-abc@acme.com>' } },
})

const MAILGUN_HARD_FAILED = mailgunEventFixture({
  event: 'failed',
  severity: 'permanent',
  recipient: 'Customer@Example.com',
  reason: 'bounce',
  'delivery-status': { description: 'mailbox does not exist' },
  message: { headers: { 'message-id': '<reply-abc@acme.com>' } },
})

const MAILGUN_SOFT_FAILED = {
  ...MAILGUN_HARD_FAILED,
  'event-data': { ...MAILGUN_HARD_FAILED['event-data'], severity: 'temporary' },
}

describe('MailgunChannelDriver delivery events', () => {
  const driver = new MailgunChannelDriver({ signingKey: MAILGUN_SIGNING_KEY, accountKey: 'mailgun-account' })

  it('parses a delivered event', () => {
    const event = driver.parseDeliveryEvent(MAILGUN_DELIVERED)
    expect(event).toEqual({
      providerEventId: 'mg-event-1',
      providerAccountKey: 'mg.acme.com',
      correlationKey: 'delivery-1',
      providerMessageId: 'reply-abc@acme.com',
      rfcMessageId: 'reply-abc@acme.com',
      recordType: 'delivered',
      recipient: 'customer@example.com',
      occurredAt: new Date(1788256800 * 1000),
      error: null,
      bounceType: null,
      description: null,
    })
  })

  it('parses a permanent failure as bounced/hard, with the delivery-status description', () => {
    const event = driver.parseDeliveryEvent(MAILGUN_HARD_FAILED)
    expect(event.recordType).toBe('bounced')
    expect(event.bounceType).toBe('hard')
    expect(event.description).toBe('mailbox does not exist')
  })

  it('parses a temporary failure as bounced/soft', () => {
    const event = driver.parseDeliveryEvent(MAILGUN_SOFT_FAILED)
    expect(event.bounceType).toBe('soft')
  })

  it("reads Frogmail's provider-assigned Message-ID, keeping correlation on the sent one", () => {
    // Shape from Frogmail's MailgunEventData: message.headers.message-id stays
    // the send-time id, frogmail.provider-message-id is what SES sent it as.
    const event = driver.parseDeliveryEvent(
      mailgunEventFixture({
        event: 'delivered',
        recipient: 'customer@example.com',
        message: { headers: { 'message-id': 'reply-abc@acme.com' } },
        frogmail: { 'provider-message-id': '0100019b-provider-000000@eu-west-1.amazonses.com' },
      })
    )

    expect(event.providerMessageId).toBe('reply-abc@acme.com')
    expect(event.rfcMessageId).toBe('0100019b-provider-000000@eu-west-1.amazonses.com')
  })

  it('falls back to the sent Message-ID when the Frogmail extension is absent or empty', () => {
    // Real Mailgun has no `frogmail` object and keeps the sent Message-ID.
    expect(driver.parseDeliveryEvent(MAILGUN_DELIVERED).rfcMessageId).toBe('reply-abc@acme.com')
    for (const frogmail of [{}, { 'provider-message-id': '' }, { 'provider-message-id': 42 }, null]) {
      const event = driver.parseDeliveryEvent(
        mailgunEventFixture({
          event: 'delivered',
          message: { headers: { 'message-id': '<reply-abc@acme.com>' } },
          frogmail,
        })
      )
      expect(event.rfcMessageId).toBe('reply-abc@acme.com')
    }
  })

  it('strips angle brackets from the provider-assigned Message-ID', () => {
    const event = driver.parseDeliveryEvent(
      mailgunEventFixture({
        event: 'delivered',
        message: { headers: { 'message-id': 'reply-abc@acme.com' } },
        frogmail: { 'provider-message-id': '<ses-1@email.amazonses.com>' },
      })
    )
    expect(event.rfcMessageId).toBe('ses-1@email.amazonses.com')
  })

  it('keys every event by event-data.id', () => {
    expect(driver.extractDeliveryEventId(MAILGUN_DELIVERED)).toBe('mg-event-1')
    expect(driver.extractDeliveryEventId(MAILGUN_HARD_FAILED)).toBe('mg-event-1')
  })

  it('returns null when Mailgun supplies no event trace id', () => {
    expect(
      driver.extractDeliveryEventId({
        ...MAILGUN_DELIVERED,
        'event-data': { ...MAILGUN_DELIVERED['event-data'], id: undefined },
      })
    ).toBeNull()
  })

  it('verifies the same signature envelope as inbound mail', () => {
    expect(driver.verifySignature({ rawBody: JSON.stringify(MAILGUN_DELIVERED), headers: {} })).toBe(true)
  })

  it('rejects a delivery payload with a bad signature', () => {
    const tampered = { ...MAILGUN_DELIVERED, signature: { ...MAILGUN_DELIVERED.signature, signature: 'deadbeef' } }
    expect(driver.verifySignature({ rawBody: JSON.stringify(tampered), headers: {} })).toBe(false)
  })
})
