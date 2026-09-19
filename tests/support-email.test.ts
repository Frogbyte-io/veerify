import { describe, expect, it } from 'vitest'

import {
  appendSignature,
  buildOutboundIdentity,
  buildQuotedHistory,
  buildReferences,
  generateMessageId,
} from '../lib/support-email'

describe('generateMessageId', () => {
  it('joins the seed and domain with an @, no angle brackets', () => {
    expect(generateMessageId({ messageId: 'abc123', domain: 'support.example.com' })).toBe('abc123@support.example.com')
  })

  /**
   * Pins the convention `parallel-agents.md` calls the stage's most likely
   * silent bug: Stage 03 stores `InboundMessage.messageId` with angle
   * brackets stripped (`normalizeMessageId` in
   * `server/services/support-channels/types.ts`). If this ever returned a
   * bracketed value, threading would match nothing and every customer reply
   * would open a new ticket.
   */
  it('never returns a bracketed value, matching Stage 03s stripped storage form', () => {
    const result = generateMessageId({ messageId: 'abc123', domain: 'support.example.com' })
    expect(result.startsWith('<')).toBe(false)
    expect(result.endsWith('>')).toBe(false)
  })
})

describe('buildReferences', () => {
  it('appends inReplyTo to the end of the existing chain', () => {
    expect(buildReferences({ existing: ['root@a', 'mid@a'], inReplyTo: 'parent@a' })).toEqual([
      'root@a',
      'mid@a',
      'parent@a',
    ])
  })

  it('leaves the chain unchanged when inReplyTo is null', () => {
    expect(buildReferences({ existing: ['root@a'], inReplyTo: null })).toEqual(['root@a'])
  })

  it('starts a fresh chain when there is no existing history', () => {
    expect(buildReferences({ existing: [], inReplyTo: 'root@a' })).toEqual(['root@a'])
  })

  it('returns an empty chain when there is neither history nor a parent', () => {
    expect(buildReferences({ existing: [], inReplyTo: null })).toEqual([])
  })

  it('does not duplicate inReplyTo when it is already the last entry', () => {
    // The immediate parent's own References chain already ends with its
    // own id when the endpoint re-derives the chain from a stored message.
    expect(buildReferences({ existing: ['root@a', 'parent@a'], inReplyTo: 'parent@a' })).toEqual(['root@a', 'parent@a'])
  })

  it('trims a long chain to maxEntries, keeping the root and the most recent entries', () => {
    const existing = ['root@a', 'two@a', 'three@a', 'four@a', 'five@a']
    const result = buildReferences({ existing, inReplyTo: 'six@a', maxEntries: 4 })
    // Root must survive - mail clients tolerate trimming but not a broken
    // root - and the tail must stay the most recent, ending with inReplyTo.
    expect(result).toEqual(['root@a', 'four@a', 'five@a', 'six@a'])
  })

  it('does not trim a chain at or under maxEntries', () => {
    const existing = ['root@a', 'two@a']
    const result = buildReferences({ existing, inReplyTo: 'three@a', maxEntries: 3 })
    expect(result).toEqual(['root@a', 'two@a', 'three@a'])
  })
})

describe('buildQuotedHistory', () => {
  it('returns empty strings when there is no previous message', () => {
    expect(buildQuotedHistory({ previous: [] })).toEqual({ html: '', text: '' })
  })

  it('prefixes every body line with "> " and header names the sender and date', () => {
    const sentAt = new Date('2026-08-17T10:00:00.000Z')
    const result = buildQuotedHistory({
      previous: [{ fromName: 'Jane Customer', sentAt, body: 'Line one\nLine two', bodyHtml: null }],
    })
    expect(result.text).toBe(`On ${sentAt.toUTCString()}, Jane Customer wrote:\n> Line one\n> Line two`)
  })

  it('uses bodyHtml verbatim inside a blockquote when present', () => {
    const sentAt = new Date('2026-08-17T10:00:00.000Z')
    const result = buildQuotedHistory({
      previous: [{ fromName: 'Jane Customer', sentAt, body: 'plain', bodyHtml: '<p>rich <b>text</b></p>' }],
    })
    expect(result.html).toContain('<blockquote>')
    expect(result.html).toContain('<p>rich <b>text</b></p>')
  })

  it('falls back to escaped, line-broken body when bodyHtml is null', () => {
    const sentAt = new Date('2026-08-17T10:00:00.000Z')
    const result = buildQuotedHistory({
      previous: [{ fromName: 'Jane Customer', sentAt, body: 'a < b\nsecond line', bodyHtml: null }],
    })
    expect(result.html).toContain('a &lt; b<br>second line')
  })

  it('escapes an HTML-hostile sender name in the header', () => {
    const sentAt = new Date('2026-08-17T10:00:00.000Z')
    const result = buildQuotedHistory({
      previous: [{ fromName: '<script>evil</script>', sentAt, body: 'hi', bodyHtml: null }],
    })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

describe('buildOutboundIdentity', () => {
  it('sets from.name when the inbox has a fromName', () => {
    const result = buildOutboundIdentity({ emailAddress: 'support@acme.com', fromName: 'Acme Support' })
    expect(result.from).toEqual({ address: 'support@acme.com', name: 'Acme Support' })
  })

  it('omits from.name rather than setting it empty when fromName is null', () => {
    const result = buildOutboundIdentity({ emailAddress: 'support@acme.com', fromName: null })
    expect(result.from).toEqual({ address: 'support@acme.com' })
    expect('name' in result.from).toBe(false)
  })

  it('sets replyTo to the same address as from', () => {
    const result = buildOutboundIdentity({ emailAddress: 'support@acme.com', fromName: 'Acme Support' })
    expect(result.replyTo).toBe('support@acme.com')
  })
})

describe('appendSignature', () => {
  it('returns the body unchanged when there is no signature', () => {
    expect(appendSignature({ html: '<p>hi</p>', text: 'hi', signature: null })).toEqual({
      html: '<p>hi</p>',
      text: 'hi',
    })
  })

  it('returns the body unchanged when the signature is empty', () => {
    expect(appendSignature({ html: '<p>hi</p>', text: 'hi', signature: '' })).toEqual({
      html: '<p>hi</p>',
      text: 'hi',
    })
  })

  it('appends the signature to text behind the conventional "-- " delimiter', () => {
    const result = appendSignature({ html: '<p>hi</p>', text: 'hi', signature: 'Jane\nSupport Team' })
    expect(result.text).toBe('hi\n\n-- \nJane\nSupport Team')
  })

  it('appends an escaped, line-broken signature to html', () => {
    const result = appendSignature({ html: '<p>hi</p>', text: 'hi', signature: 'Jane\nSupport Team' })
    expect(result.html).toBe('<p>hi</p><br><br>Jane<br>Support Team')
  })

  it('escapes HTML-hostile characters in the signature', () => {
    const result = appendSignature({ html: '<p>hi</p>', text: 'hi', signature: '<b>Jane</b>' })
    expect(result.html).toContain('&lt;b&gt;Jane&lt;/b&gt;')
    expect(result.html).not.toContain('<b>Jane</b>')
  })
})
