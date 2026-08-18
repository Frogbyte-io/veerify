import { describe, expect, it } from 'vitest'

import { buildMailPayload } from '../lib/email'

/**
 * SUP-04-1. `sendEmail` grows an options bag so support replies can carry a
 * per-inbox From, a Reply-To, CC, RFC-5322 threading headers and attachments.
 *
 * The payload builder is separated from the transport precisely so this is
 * testable: `sendEmail` itself reaches for `useNodeMailer()`, a Nuxt
 * auto-import that does not exist under plain vitest.
 *
 * The first group is the one that matters most. All 10 existing call sites
 * pass exactly `{ to, subject, html, text }`, and the stage doc's requirement
 * is that they "keep working unchanged" - so these assert the payload is
 * byte-identical to what the transport received before this change.
 */
describe('buildMailPayload - existing call sites are unaffected', () => {
  it('passes through to, subject, html and text unchanged', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Verify your email',
      html: '<p>Click here</p>',
      text: 'Click here',
    })

    expect(payload.to).toBe('ada@example.com')
    expect(payload.subject).toBe('Verify your email')
    expect(payload.html).toBe('<p>Click here</p>')
    expect(payload.text).toBe('Click here')
  })

  it('emits no optional keys at all when none were supplied', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Verify your email',
      html: '<p>Click here</p>',
      text: 'Click here',
    })

    // `from` in particular must stay absent: nuxt-nodemailer injects MAIL_FROM
    // when the key is missing, and sending `from: undefined` is not the same
    // thing to every transport. The rest are asserted so a future refactor
    // cannot start emitting empty arrays that a provider might reject.
    expect(Object.keys(payload).sort()).toEqual(['html', 'subject', 'text', 'to'])
  })

  it('keeps the html fallback built from text', () => {
    const payload = buildMailPayload({ to: 'ada@example.com', subject: 'Hi', text: 'Plain only' })

    expect(payload.html).toBe('<p>Plain only</p>')
  })

  it('keeps the placeholder body when neither html nor text is given', () => {
    const payload = buildMailPayload({ to: 'ada@example.com', subject: 'Hi' })

    expect(payload.html).toBe('<p>Hello from Veerify!</p>')
    expect(payload.text).toBe('Hello from Veerify!')
  })
})

describe('buildMailPayload - per-inbox identity and recipients', () => {
  it('sends From as a structured address so nodemailer handles display-name quoting', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Re: Cannot sign in',
      text: 'Have you tried a password reset?',
      from: { address: 'support@acme.com', name: 'Acme Support, Ltd.' },
    })

    // The string form would need RFC-5322 quoting for the comma in that display
    // name. Handing nodemailer the object form makes that its problem, not ours.
    expect(payload.from).toEqual({ address: 'support@acme.com', name: 'Acme Support, Ltd.' })
  })

  it('omits the display name when the inbox has no fromName', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Re: Cannot sign in',
      text: 'Hello',
      from: { address: 'support@acme.com' },
    })

    // nodemailer's Address type requires `name`; an empty one renders as a
    // bare `From: support@acme.com` - verified against MailComposer, not assumed.
    expect(payload.from).toEqual({ address: 'support@acme.com', name: '' })
  })

  it('carries cc recipients and a reply-to', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      cc: ['billing@acme.com', 'grace@example.com'],
      replyTo: 'support@acme.com',
      subject: 'Re: Cannot sign in',
      text: 'Hello',
    })

    expect(payload.cc).toEqual(['billing@acme.com', 'grace@example.com'])
    expect(payload.replyTo).toBe('support@acme.com')
  })

  it('omits cc entirely when the list is empty', () => {
    const payload = buildMailPayload({ to: 'ada@example.com', subject: 'Hi', text: 'Hello', cc: [] })

    expect('cc' in payload).toBe(false)
  })

  it('accepts several to recipients', () => {
    const payload = buildMailPayload({
      to: ['ada@example.com', 'grace@example.com'],
      subject: 'Hi',
      text: 'Hello',
    })

    expect(payload.to).toEqual(['ada@example.com', 'grace@example.com'])
  })
})

describe('buildMailPayload - RFC-5322 threading headers', () => {
  /**
   * These three are lifted onto nodemailer's first-class options rather than
   * left in the generic `headers` bag.
   *
   * Not because the raw bag is broken - it is not. Verified against
   * MailComposer: nodemailer emits exactly one `Message-ID` either way, and
   * when both the option and a raw header are set, the option wins. The point
   * is a single canonical path instead of two that disagree quietly, and
   * typed fields the delivery worker can read: it must store the Message-ID on
   * `conversationMessage.channelMessageId` or Stage 03 cannot thread the
   * customer's reply back onto the conversation.
   */
  it('lifts Message-ID onto the messageId option rather than a raw header', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Re: Cannot sign in',
      text: 'Hello',
      headers: { 'Message-ID': '<reply-9@acme.com>' },
    })

    expect(payload.messageId).toBe('<reply-9@acme.com>')
    expect(payload.headers).toBeUndefined()
  })

  it('lifts In-Reply-To and References onto their own options', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Re: Cannot sign in',
      text: 'Hello',
      headers: {
        'In-Reply-To': '<parent-1@acme.com>',
        References: '<root-0@acme.com> <parent-1@acme.com>',
      },
    })

    expect(payload.inReplyTo).toBe('<parent-1@acme.com>')
    expect(payload.references).toBe('<root-0@acme.com> <parent-1@acme.com>')
  })

  it('matches threading header names case-insensitively', () => {
    // Providers and our own code disagree on Message-ID vs Message-Id, and a
    // miss here silently reintroduces the duplicate-header bug above.
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      headers: { 'message-id': '<a@b>', 'in-reply-to': '<c@d>', REFERENCES: '<e@f>' },
    })

    expect(payload.messageId).toBe('<a@b>')
    expect(payload.inReplyTo).toBe('<c@d>')
    expect(payload.references).toBe('<e@f>')
  })

  it('leaves other headers in the headers bag', () => {
    // Auto-Submitted is SUP-04-8's loop guard and has no nodemailer option,
    // so it has to survive as a raw header.
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      headers: { 'Auto-Submitted': 'auto-replied', 'Message-ID': '<a@b>' },
    })

    expect(payload.headers).toEqual({ 'Auto-Submitted': 'auto-replied' })
    expect(payload.messageId).toBe('<a@b>')
  })
})

describe('buildMailPayload - attachments', () => {
  it('carries attachments through with their inline content id', () => {
    const payload = buildMailPayload({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      attachments: [
        { filename: 'screenshot.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'inline-1' },
      ],
    })

    expect(payload.attachments).toEqual([
      { filename: 'screenshot.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'inline-1' },
    ])
  })

  it('omits attachments entirely when the list is empty', () => {
    const payload = buildMailPayload({ to: 'ada@example.com', subject: 'Hi', text: 'Hello', attachments: [] })

    expect('attachments' in payload).toBe(false)
  })
})
