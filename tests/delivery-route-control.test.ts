import { describe, expect, it } from 'vitest'

import {
  selectDeliveryCorrelationCandidate,
  type DeliveryCorrelationCandidate,
  type DeliveryCorrelationInput,
} from '../server/utils/outbound-delivery'

const event: DeliveryCorrelationInput = {
  provider: 'postmark',
  providerAccountKey: 'server-a',
  correlationKey: null,
  providerMessageId: 'provider-message-1',
  recipient: 'customer@example.com',
}

function candidate(overrides: Partial<DeliveryCorrelationCandidate> = {}): DeliveryCorrelationCandidate {
  return {
    messageId: 'message-1',
    conversationId: 'conversation-1',
    idempotencyKey: 'delivery-1',
    provider: 'postmark',
    providerAccountKey: 'server-a',
    providerMessageId: 'provider-message-1',
    payload: { to: 'customer@example.com', subject: 'Hello' },
    ...overrides,
  }
}

describe('delivery route correlation controls', () => {
  it('prefers the globally unique durable correlation key', () => {
    const expected = candidate({ providerMessageId: 'different-provider-id' })
    expect(selectDeliveryCorrelationCandidate({ ...event, correlationKey: 'delivery-1' }, [expected])).toBe(expected)
  })

  it('falls back to one exact provider/account/message/recipient match', () => {
    const expected = candidate()
    expect(selectDeliveryCorrelationCandidate(event, [expected])).toBe(expected)
  })

  it('matches one recipient from a multi-recipient outbound payload', () => {
    const expected = candidate({ payload: { to: ['first@example.com', 'customer@example.com'], subject: 'Hello' } })
    expect(selectDeliveryCorrelationCandidate(event, [expected])).toBe(expected)
  })

  it('fails closed when the provider fallback is ambiguous', () => {
    expect(
      selectDeliveryCorrelationCandidate(event, [candidate(), candidate({ messageId: 'message-2' })])
    ).toBeNull()
  })

  it('records a valid event as uncorrelated when no identity matches', () => {
    expect(selectDeliveryCorrelationCandidate(event, [candidate({ providerMessageId: 'other' })])).toBeNull()
  })

  it('isolates duplicate provider event identities between provider accounts', () => {
    const expected = candidate()
    const otherAccount = candidate({ messageId: 'message-2', providerAccountKey: 'server-b' })
    expect(selectDeliveryCorrelationCandidate(event, [expected, otherAccount])).toBe(expected)
  })

  it('does not interpret a provider ID equal to another message RFC Message-ID', () => {
    const spoofedEvent = { ...event, providerMessageId: 'victim-rfc-id@example.com' }
    const victim = candidate({ providerMessageId: null })
    expect(selectDeliveryCorrelationCandidate(spoofedEvent, [victim])).toBeNull()
  })
})
