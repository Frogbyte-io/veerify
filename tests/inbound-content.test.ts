import { describe, expect, it } from 'vitest'

import { stripQuotedReply } from '../server/utils/inbound-content'
import { isAutoResponse } from '../server/utils/inbound-autoresponse'

describe('stripQuotedReply', () => {
  it('returns empty for empty input, without throwing', () => {
    expect(stripQuotedReply({ text: null, html: null })).toEqual({ body: '', rawBody: '' })
  })

  it('leaves a message with no quoted history untouched', () => {
    const text = 'Hi, I still cannot sign in.\n\nThanks,\nJane'
    expect(stripQuotedReply({ text, html: null }).body).toBe(text)
  })

  it('strips a Gmail-style attribution and everything after it', () => {
    const text = [
      'That worked, thanks!',
      '',
      'On Mon, 3 Aug 2026 at 14:02, Support <support@acme.com> wrote:',
      '> Have you tried resetting your password?',
      '> Let us know.',
    ].join('\n')

    expect(stripQuotedReply({ text, html: null }).body).toBe('That worked, thanks!')
  })

  it('strips a Gmail attribution that wrapped across lines', () => {
    // Clients wrap long attributions; anchoring on "On … wrote:" has to survive it.
    const text = [
      'Still broken.',
      '',
      'On Mon, 3 Aug 2026 at 14:02, Veerify Support',
      '<support@acme.com> wrote:',
      '> Could you send a screenshot?',
    ].join('\n')

    expect(stripQuotedReply({ text, html: null }).body).toBe('Still broken.')
  })

  it('strips an Outlook Original Message divider', () => {
    const text = ['Confirmed fixed.', '', '-----Original Message-----', 'From: Support', 'Sent: Monday'].join('\n')
    expect(stripQuotedReply({ text, html: null }).body).toBe('Confirmed fixed.')
  })

  it('strips an Outlook header block that has no divider', () => {
    const text = ['See below.', '', 'From: Support <support@acme.com>', 'Sent: 03 August 2026 14:02', 'To: Jane'].join(
      '\n'
    )
    expect(stripQuotedReply({ text, html: null }).body).toBe('See below.')
  })

  it('strips a localised Outlook divider', () => {
    const text = ['Danke, behoben.', '', '-----Ursprüngliche Nachricht-----', 'Von: Support'].join('\n')
    expect(stripQuotedReply({ text, html: null }).body).toBe('Danke, behoben.')
  })

  it('strips an RFC 3676 signature', () => {
    const text = ['Any update on this?', '', '-- ', 'Jane Doe', 'Acme Ltd'].join('\n')
    expect(stripQuotedReply({ text, html: null }).body).toBe('Any update on this?')
  })

  it('strips a signature whose trailing space was lost in transit', () => {
    const text = ['Any update?', '', '--', 'Jane Doe'].join('\n')
    expect(stripQuotedReply({ text, html: null }).body).toBe('Any update?')
  })

  it('drops trailing quoted lines that carry no attribution marker', () => {
    const text = ['Nope, still failing.', '', '> Have you cleared your cache?', '> — Support'].join('\n')
    expect(stripQuotedReply({ text, html: null }).body).toBe('Nope, still failing.')
  })

  it('cuts at the earliest marker when a message contains several', () => {
    const text = [
      'Top reply.',
      '',
      'On Mon, 3 Aug 2026, Support <s@acme.com> wrote:',
      '> -----Original Message-----',
      '> older stuff',
    ].join('\n')

    expect(stripQuotedReply({ text, html: null }).body).toBe('Top reply.')
  })

  it('falls back to flattened HTML when there is no text part', () => {
    const html = '<div><p>Hello there</p><p>Second line</p></div>'
    expect(stripQuotedReply({ text: null, html }).body).toBe('Hello there\n\nSecond line')
  })

  it('decodes entities and drops script and style when flattening HTML', () => {
    const html = '<style>p{color:red}</style><script>alert(1)</script><p>Tom &amp; Jerry</p>'
    const body = stripQuotedReply({ text: null, html }).body
    expect(body).toBe('Tom & Jerry')
    expect(body).not.toContain('alert')
  })

  it('prefers the text part when both are present', () => {
    const result = stripQuotedReply({ text: 'plain version', html: '<p>html version</p>' })
    expect(result.body).toBe('plain version')
  })

  it('always preserves the original in rawBody', () => {
    const text = ['Reply.', '', 'On Mon, Support <s@acme.com> wrote:', '> quoted'].join('\n')
    const result = stripQuotedReply({ text, html: null })
    expect(result.rawBody).toBe(text)
    expect(result.rawBody).toContain('quoted')
  })

  it('does not return an empty body when a message is nothing but a quote', () => {
    // The heuristics misfiring must not silently blank a message; better to
    // show too much than to store nothing.
    const text = 'On Mon, 3 Aug 2026, Support <s@acme.com> wrote:\n> only quoted content'
    expect(stripQuotedReply({ text, html: null }).body).not.toBe('')
  })
})

describe('isAutoResponse', () => {
  it('is false for ordinary mail', () => {
    expect(isAutoResponse({ From: 'jane@example.com', Subject: 'Help' })).toBe(false)
  })

  it('detects Auto-Submitted values other than no', () => {
    expect(isAutoResponse({ 'Auto-Submitted': 'auto-replied' })).toBe(true)
    expect(isAutoResponse({ 'Auto-Submitted': 'auto-generated' })).toBe(true)
    expect(isAutoResponse({ 'Auto-Submitted': 'auto-notified' })).toBe(true)
  })

  it('treats Auto-Submitted: no as a real message', () => {
    expect(isAutoResponse({ 'Auto-Submitted': 'no' })).toBe(false)
  })

  it('is case-insensitive on both header name and value', () => {
    expect(isAutoResponse({ 'auto-submitted': 'AUTO-REPLIED' })).toBe(true)
    expect(isAutoResponse({ 'AUTO-SUBMITTED': 'auto-replied' })).toBe(true)
  })

  it('detects the non-standard vacation-reply headers', () => {
    expect(isAutoResponse({ 'X-Autoreply': 'yes' })).toBe(true)
    expect(isAutoResponse({ 'X-Autorespond': 'anything' })).toBe(true)
    expect(isAutoResponse({ 'X-Auto-Response-Suppress': 'OOF' })).toBe(true)
  })

  it('detects a null return-path, which marks a bounce', () => {
    expect(isAutoResponse({ 'Return-Path': '<>' })).toBe(true)
  })

  it('does not treat a normal return-path as automated', () => {
    expect(isAutoResponse({ 'Return-Path': '<jane@example.com>' })).toBe(false)
  })

  it('detects Precedence: auto_reply but not bulk or list', () => {
    expect(isAutoResponse({ Precedence: 'auto_reply' })).toBe(true)
    // Deliberate: customers forward newsletters and notifications, and those
    // carry bulk/list routinely. Dropping them would lose real requests.
    expect(isAutoResponse({ Precedence: 'bulk' })).toBe(false)
    expect(isAutoResponse({ Precedence: 'list' })).toBe(false)
  })

  it('ignores non-string header values without throwing', () => {
    expect(isAutoResponse({ 'Auto-Submitted': undefined as unknown as string })).toBe(false)
  })
})
