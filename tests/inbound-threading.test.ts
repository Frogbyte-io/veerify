import { describe, expect, it } from 'vitest'

import type { InboundMessage } from '../server/services/support-channels/types'
import type { ThreadableMessage } from '../server/utils/inbound-threading'
import {
  normalizeSubject,
  resolveMessageIdMatches,
  SUBJECT_FALLBACK_WINDOW_DAYS,
  updatesForInboundReply,
} from '../server/utils/inbound-threading'

/**
 * Compile-time proof that the two halves of Stage 03 actually fit.
 *
 * `resolveThread` takes a structural `ThreadableMessage` rather than importing
 * `InboundMessage`, so `server/utils` does not depend on
 * `server/services/support-channels`. That is only safe if an `InboundMessage`
 * really does satisfy it — and nothing calls `resolveThread` with one yet
 * (the endpoint is SUP-03-4), so without this assertion the seam would go
 * unchecked until integration.
 *
 * Stage 02 shipped a feature that was correct on both sides and broken where
 * they met, precisely because no check spanned the boundary. `yarn typecheck`
 * fails here if either side drifts.
 */
const _inboundMessageSatisfiesThreadable: ThreadableMessage = {} as InboundMessage
void _inboundMessageSatisfiesThreadable

/**
 * Subject normalization is where the threading fallback most easily goes wrong,
 * so it is exported and tested on its own. The three resolution strategies need
 * real rows and are covered in `tests/integration/inbound-threading.test.ts`.
 */
describe('normalizeSubject', () => {
  it('returns empty for null or blank', () => {
    expect(normalizeSubject(null)).toBe('')
    expect(normalizeSubject('   ')).toBe('')
  })

  it('lowercases and collapses whitespace so formatting drift still matches', () => {
    expect(normalizeSubject('  Invoice   Question  ')).toBe('invoice question')
  })

  it('strips a single reply prefix', () => {
    expect(normalizeSubject('Re: Invoice question')).toBe('invoice question')
  })

  it('strips stacked prefixes', () => {
    expect(normalizeSubject('Re: Fwd: Re: Invoice question')).toBe('invoice question')
  })

  it('strips numbered prefixes some clients emit', () => {
    expect(normalizeSubject('Re[2]: Invoice question')).toBe('invoice question')
  })

  it('is case-insensitive about the prefix', () => {
    expect(normalizeSubject('RE: Invoice')).toBe('invoice')
    expect(normalizeSubject('fwd: Invoice')).toBe('invoice')
  })

  it('strips localised prefixes', () => {
    expect(normalizeSubject('AW: Rechnung')).toBe('rechnung')
    expect(normalizeSubject('WG: Rechnung')).toBe('rechnung')
    expect(normalizeSubject('SV: Faktura')).toBe('faktura')
    expect(normalizeSubject('RES: Fatura')).toBe('fatura')
  })

  it('tolerates spacing variants around the prefix', () => {
    expect(normalizeSubject('Re : Invoice')).toBe('invoice')
    expect(normalizeSubject('Re:Invoice')).toBe('invoice')
  })

  it('does not eat a subject that merely starts with those letters', () => {
    // "Refund" starts with "Re" but has no colon - it is the whole subject.
    expect(normalizeSubject('Refund request')).toBe('refund request')
    expect(normalizeSubject('Review of our plan')).toBe('review of our plan')
  })

  it('leaves a colon that is not a reply prefix alone', () => {
    expect(normalizeSubject('Bug: cannot sign in')).toBe('bug: cannot sign in')
  })

  it('treats differently-prefixed versions of one subject as equal', () => {
    expect(normalizeSubject('Re: Cannot sign in')).toBe(normalizeSubject('Cannot sign in'))
    expect(normalizeSubject('FWD: cannot sign IN')).toBe(normalizeSubject('Cannot sign in'))
  })

  it('keeps distinct subjects distinct', () => {
    expect(normalizeSubject('Re: Invoice')).not.toBe(normalizeSubject('Re: Refund'))
  })

  it('bounds the fallback window', () => {
    // A wide window turns unrelated same-subject mail into a false match.
    expect(SUBJECT_FALLBACK_WINDOW_DAYS).toBeGreaterThan(0)
    expect(SUBJECT_FALLBACK_WINDOW_DAYS).toBeLessThanOrEqual(30)
  })
})

describe('inbound conversation updates', () => {
  it('reopens a resolved thread while preserving its assignee', () => {
    const receivedAt = new Date('2026-09-07T12:00:00.000Z')
    const updatedAt = new Date('2026-09-07T12:00:01.000Z')
    const existing = {
      status: 'resolved',
      resolvedAt: new Date('2026-09-06T12:00:00.000Z'),
      assigneeUserId: 'agent-a',
    }

    const updates = updatesForInboundReply(existing, receivedAt, updatedAt)
    expect(updates).toEqual({
      status: 'open',
      resolvedAt: null,
      lastActivityAt: receivedAt,
      lastCustomerReplyAt: receivedAt,
      updatedAt,
    })
    expect({ ...existing, ...updates }).toMatchObject({
      status: 'open',
      resolvedAt: null,
      assigneeUserId: 'agent-a',
    })
  })

  it('resumes a pending thread when the customer replies', () => {
    const receivedAt = new Date('2026-09-07T12:00:00.000Z')
    const updatedAt = new Date('2026-09-07T12:00:01.000Z')
    expect(updatesForInboundReply({ status: 'pending' }, receivedAt, updatedAt)).toMatchObject({
      status: 'open',
      lastCustomerReplyAt: receivedAt,
      updatedAt,
    })
  })
})

describe('resolveMessageIdMatches', () => {
  const customerOriginal = 'customer-original@customer.example'
  const ourOriginal = 'our-reply@veerify.example'
  const ourSesId = '0100019a-ses@email.amazonses.com'

  function stored(
    conversationId: string,
    channelMessageId: string | null,
    providerChannelMessageId: string | null = null
  ) {
    return { conversationId, channelMessageId, providerChannelMessageId }
  }

  it('returns null when nothing matched, leaving the thread-key fallback to run', () => {
    expect(resolveMessageIdMatches({ inReplyTo: 'a@x', references: [] }, [])).toBeNull()
  })

  it('continues the conversation when References names the customer original and our reply', () => {
    const result = resolveMessageIdMatches({ inReplyTo: ourOriginal, references: [customerOriginal, ourOriginal] }, [
      stored('conv-1', ourOriginal),
      stored('conv-1', customerOriginal),
    ])

    expect(result).toEqual({ conversationId: 'conv-1', matchedBy: 'message-id' })
  })

  it('continues the production shape: customer original, unknown SES id, then our Frogmail original id', () => {
    const unknownSesId = '0100019b-unknown@email.amazonses.com'
    const result = resolveMessageIdMatches(
      { inReplyTo: unknownSesId, references: [customerOriginal, unknownSesId, ourOriginal] },
      [stored('conv-1', ourOriginal, ourSesId), stored('conv-1', customerOriginal)]
    )

    expect(result).toEqual({ conversationId: 'conv-1', matchedBy: 'message-id' })
  })

  it('attributes a row matched only through its provider id', () => {
    const result = resolveMessageIdMatches({ inReplyTo: ourSesId, references: [customerOriginal, ourSesId] }, [
      stored('conv-1', ourOriginal, ourSesId),
      stored('conv-1', customerOriginal),
    ])

    expect(result).toEqual({ conversationId: 'conv-1', matchedBy: 'message-id' })
  })

  it('stays ambiguous when one id names two stored messages, even in one conversation', () => {
    const result = resolveMessageIdMatches({ inReplyTo: ourOriginal, references: [] }, [
      stored('conv-1', ourOriginal),
      stored('conv-1', ourOriginal),
    ])

    expect(result).toEqual({ conversationId: null, matchedBy: 'ambiguous-message-id' })
  })

  it('stays ambiguous when one id names one message by its own id and another by provider id', () => {
    const result = resolveMessageIdMatches({ inReplyTo: ourSesId, references: [] }, [
      stored('conv-1', ourSesId),
      stored('conv-2', ourOriginal, ourSesId),
    ])

    expect(result).toEqual({ conversationId: null, matchedBy: 'ambiguous-message-id' })
  })

  it('prefers the In-Reply-To conversation over an older References entry elsewhere', () => {
    const result = resolveMessageIdMatches({ inReplyTo: 'parent@x', references: ['older@x', 'parent@x'] }, [
      stored('conv-b', 'older@x'),
      stored('conv-a', 'parent@x'),
    ])

    expect(result).toEqual({ conversationId: 'conv-a', matchedBy: 'message-id' })
  })

  it('prefers the In-Reply-To conversation even when References puts another conversation last', () => {
    const result = resolveMessageIdMatches({ inReplyTo: 'parent@x', references: ['parent@x', 'newer@x'] }, [
      stored('conv-b', 'newer@x'),
      stored('conv-a', 'parent@x'),
    ])

    expect(result).toEqual({ conversationId: 'conv-a', matchedBy: 'message-id' })
  })

  it('takes the newest matching References entry when In-Reply-To matched nothing', () => {
    const result = resolveMessageIdMatches(
      { inReplyTo: 'unknown@x', references: ['oldest@x', 'newest-match@x', 'unknown@x'] },
      [stored('conv-old', 'oldest@x'), stored('conv-new', 'newest-match@x')]
    )

    expect(result).toEqual({ conversationId: 'conv-new', matchedBy: 'message-id' })
  })
})
