import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { PostmarkChannelDriver } from '../server/services/support-channels/webhook/postmark'
import { MailgunChannelDriver, parseAddressList } from '../server/services/support-channels/webhook/mailgun'
import { getChannelDriver, isSupportChannelProvider } from '../server/services/support-channels/index'
import { normalizeMessageId, parseReferences, normalizeHeaders } from '../server/services/support-channels/types'

/**
 * Fixtures are trimmed captures of real provider payload shapes. They exist so
 * a provider changing its field names fails here rather than silently
 * producing an InboundMessage with a null From at 3am.
 */

const POSTMARK_FIXTURE = {
  MessageID: '<abc-123@inbound.postmarkapp.com>',
  FromFull: { Email: 'Ada@Example.com', Name: 'Ada Lovelace' },
  ToFull: [{ Email: 'support@acme.com', Name: 'Acme Support' }],
  CcFull: [{ Email: 'billing@acme.com' }],
  Subject: '  Cannot sign in  ',
  TextBody: 'I cannot sign in.\n\n> previous message',
  HtmlBody: '<p>I cannot sign in.</p>',
  Date: 'Tue, 12 Aug 2026 10:04:00 +0000',
  Headers: [
    { Name: 'In-Reply-To', Value: '<parent-1@acme.com>' },
    { Name: 'References', Value: '<root-0@acme.com> <parent-1@acme.com>' },
    { Name: 'X-Spam-Status', Value: 'No' },
  ],
  Attachments: [
    {
      Name: 'screenshot.png',
      Content: Buffer.from('fake-png-bytes').toString('base64'),
      ContentType: 'image/png',
      ContentLength: 999,
      ContentID: '<inline-1@acme.com>',
    },
    { Name: '../../etc/passwd', Content: Buffer.from('x').toString('base64'), ContentType: 'text/plain' },
  ],
}

const MAILGUN_SIGNING_KEY = 'test-signing-key'

function mailgunFixture(overrides: Record<string, unknown> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const token = 'tok-abc'
  const signature = createHmac('sha256', MAILGUN_SIGNING_KEY)
    .update(timestamp + token)
    .digest('hex')

  return {
    timestamp,
    token,
    signature,
    'Message-Id': '<mg-1@acme.com>',
    from: 'Ada Lovelace <Ada@Example.com>',
    recipient: 'support@acme.com',
    To: 'Acme Support <support@acme.com>, ops@acme.com',
    Cc: 'billing@acme.com',
    subject: 'Cannot sign in',
    'body-plain': 'I cannot sign in.',
    'body-html': '<p>I cannot sign in.</p>',
    'stripped-text': 'I cannot sign in.',
    'message-headers': [
      ['In-Reply-To', '<parent-1@acme.com>'],
      ['References', '<root-0@acme.com> <parent-1@acme.com>'],
      ['Date', 'Tue, 12 Aug 2026 10:04:00 +0000'],
    ],
    ...overrides,
  }
}

describe('shared header helpers', () => {
  it('strips angle brackets from message ids', () => {
    expect(normalizeMessageId('<a@b>')).toBe('a@b')
    expect(normalizeMessageId('  <a@b>  ')).toBe('a@b')
    expect(normalizeMessageId('')).toBeNull()
    expect(normalizeMessageId(undefined)).toBeNull()
  })

  it('parses References oldest to newest', () => {
    expect(parseReferences('<root@a> <parent@a>')).toEqual(['root@a', 'parent@a'])
    expect(parseReferences(null)).toEqual([])
  })

  it('lowercases header names so lookups are provider-agnostic', () => {
    expect(normalizeHeaders({ 'In-Reply-To': '<x@y>' })).toEqual({ 'in-reply-to': '<x@y>' })
  })
})

describe('PostmarkChannelDriver', () => {
  const driver = new PostmarkChannelDriver({ user: 'hook', password: 's3cret' })

  const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

  it('accepts correct basic-auth credentials', () => {
    expect(driver.verifySignature({ rawBody: '{}', headers: { authorization: basic('hook', 's3cret') } })).toBe(true)
  })

  it('rejects a wrong password, wrong user, or missing header', () => {
    expect(driver.verifySignature({ rawBody: '{}', headers: { authorization: basic('hook', 'nope') } })).toBe(false)
    expect(driver.verifySignature({ rawBody: '{}', headers: { authorization: basic('nope', 's3cret') } })).toBe(false)
    expect(driver.verifySignature({ rawBody: '{}', headers: {} })).toBe(false)
    expect(driver.verifySignature({ rawBody: '{}', headers: { authorization: 'Bearer x' } })).toBe(false)
  })

  it('fails closed when no credentials are configured', () => {
    // The endpoint is publicly reachable; unconfigured must not mean open.
    const unconfigured = new PostmarkChannelDriver({ user: '', password: '' })
    expect(unconfigured.verifySignature({ rawBody: '{}', headers: { authorization: basic('', '') } })).toBe(false)
  })

  it('uses MessageID as the idempotency key', () => {
    expect(driver.extractEventId(POSTMARK_FIXTURE)).toBe('abc-123@inbound.postmarkapp.com')
    expect(driver.extractEventId({})).toBeNull()
  })

  it('normalizes a captured payload into InboundMessage', () => {
    const message = driver.parse(POSTMARK_FIXTURE)

    expect(message.messageId).toBe('abc-123@inbound.postmarkapp.com')
    expect(message.inReplyTo).toBe('parent-1@acme.com')
    expect(message.references).toEqual(['root-0@acme.com', 'parent-1@acme.com'])
    expect(message.from).toEqual({ address: 'ada@example.com', name: 'Ada Lovelace' })
    expect(message.to).toEqual([{ address: 'support@acme.com', name: 'Acme Support' }])
    expect(message.cc).toEqual([{ address: 'billing@acme.com' }])
    expect(message.subject).toBe('Cannot sign in')
    expect(message.html).toBe('<p>I cannot sign in.</p>')
    expect(message.rawHeaders['x-spam-status']).toBe('No')
    expect(message.receivedAt.toISOString()).toBe('2026-08-12T10:04:00.000Z')
  })

  it('decodes attachments and refuses path traversal in filenames', () => {
    const message = driver.parse(POSTMARK_FIXTURE)

    expect(message.attachments).toHaveLength(2)
    expect(message.attachments[0].fileName).toBe('screenshot.png')
    expect(message.attachments[0].content.toString()).toBe('fake-png-bytes')
    // Declared ContentLength is 999; the decoded length is what matters.
    expect(message.attachments[0].size).toBe('fake-png-bytes'.length)
    expect(message.attachments[0].contentId).toBe('inline-1@acme.com')
    expect(message.attachments[0].isInline).toBe(true)

    // A provider-supplied name must never escape its storage prefix.
    expect(message.attachments[1].fileName).toBe('passwd')
    expect(message.attachments[1].isInline).toBe(false)
  })

  it('falls back to arrival time when the provider date is unparseable', () => {
    const message = driver.parse({ ...POSTMARK_FIXTURE, Date: 'not-a-date' })
    expect(Number.isNaN(message.receivedAt.getTime())).toBe(false)
  })

  it('throws on a payload with no From address', () => {
    expect(() => driver.parse({ Subject: 'x' })).toThrow(/From/)
    expect(() => driver.parse(null)).toThrow()
  })
})

describe('MailgunChannelDriver', () => {
  const driver = new MailgunChannelDriver({ signingKey: MAILGUN_SIGNING_KEY })

  it('accepts a correctly signed payload', () => {
    const payload = mailgunFixture()
    expect(driver.verifySignature({ rawBody: JSON.stringify(payload), headers: {} })).toBe(true)
  })

  it('rejects a tampered signature', () => {
    const payload = mailgunFixture({ signature: 'a'.repeat(64) })
    expect(driver.verifySignature({ rawBody: JSON.stringify(payload), headers: {} })).toBe(false)
  })

  it('rejects a stale timestamp even when the signature is valid for it', () => {
    // Replay protection: the signature over an old timestamp stays valid
    // forever, so freshness has to be enforced separately.
    const old = String(Math.floor(Date.now() / 1000) - 60 * 60)
    const token = 'tok-old'
    const signature = createHmac('sha256', MAILGUN_SIGNING_KEY)
      .update(old + token)
      .digest('hex')
    const payload = mailgunFixture({ timestamp: old, token, signature })

    expect(driver.verifySignature({ rawBody: JSON.stringify(payload), headers: {} })).toBe(false)
  })

  it('accepts the nested signature envelope shape', () => {
    const flat = mailgunFixture()
    const nested = {
      ...flat,
      timestamp: undefined,
      token: undefined,
      signature: { timestamp: flat.timestamp, token: flat.token, signature: flat.signature },
    }
    expect(driver.verifySignature({ rawBody: JSON.stringify(nested), headers: {} })).toBe(true)
  })

  it('fails closed when unconfigured, and on unparseable bodies', () => {
    const unconfigured = new MailgunChannelDriver({ signingKey: '' })
    expect(unconfigured.verifySignature({ rawBody: JSON.stringify(mailgunFixture()), headers: {} })).toBe(false)
    expect(driver.verifySignature({ rawBody: 'not json', headers: {} })).toBe(false)
  })

  it('keys idempotency on Message-Id, not the per-retry token', () => {
    expect(driver.extractEventId(mailgunFixture())).toBe('mg-1@acme.com')
    // Falls back to the header block when the top-level field is absent.
    expect(driver.extractEventId({ 'message-headers': [['Message-Id', '<hdr-1@acme.com>']] })).toBe('hdr-1@acme.com')
  })

  it('normalizes a captured payload into InboundMessage', () => {
    const message = driver.parse(mailgunFixture())

    expect(message.messageId).toBe('mg-1@acme.com')
    expect(message.inReplyTo).toBe('parent-1@acme.com')
    expect(message.references).toEqual(['root-0@acme.com', 'parent-1@acme.com'])
    expect(message.from).toEqual({ address: 'ada@example.com', name: 'Ada Lovelace' })
    expect(message.to).toEqual([{ address: 'support@acme.com', name: 'Acme Support' }, { address: 'ops@acme.com' }])
    expect(message.cc).toEqual([{ address: 'billing@acme.com' }])
    expect(message.text).toBe('I cannot sign in.')
  })

  it('hands over the full body rather than the provider stripped version', () => {
    // Quote stripping is SUP-03-6 and must behave identically for every
    // provider, so `stripped-text` must not leak through as `text`.
    const message = driver.parse(mailgunFixture({ 'body-plain': 'full body\n> quoted', 'stripped-text': 'full body' }))
    expect(message.text).toBe('full body\n> quoted')
  })

  it('parses message-headers whether array or JSON string', () => {
    const asString = mailgunFixture({ 'message-headers': JSON.stringify([['In-Reply-To', '<p@a>']]) })
    expect(driver.parse(asString).inReplyTo).toBe('p@a')
  })

  it('throws on a payload with no From address', () => {
    expect(() => driver.parse({ subject: 'x' })).toThrow(/From/)
  })
})

describe('parseAddressList', () => {
  it('handles names, bare addresses, and quoted commas', () => {
    expect(parseAddressList('a@b.com')).toEqual([{ address: 'a@b.com' }])
    expect(parseAddressList('Ada <Ada@B.com>')).toEqual([{ address: 'ada@b.com', name: 'Ada' }])
    expect(parseAddressList('"Doe, Jane" <jane@b.com>, bob@b.com')).toEqual([
      { address: 'jane@b.com', name: 'Doe, Jane' },
      { address: 'bob@b.com' },
    ])
  })

  it('drops entries that are not addresses', () => {
    expect(parseAddressList('undisclosed-recipients')).toEqual([])
    expect(parseAddressList('')).toEqual([])
    expect(parseAddressList(null)).toEqual([])
  })
})

describe('driver selection', () => {
  it('resolves known providers by name', () => {
    expect(getChannelDriver('postmark')?.name).toBe('postmark')
    expect(getChannelDriver('MAILGUN')?.name).toBe('mailgun')
  })

  it('returns null for unknown names rather than defaulting', () => {
    // Falling back would verify signatures with the wrong scheme.
    expect(getChannelDriver('typo')).toBeNull()
    expect(getChannelDriver('')).toBeNull()
    expect(getChannelDriver(undefined)).toBeNull()
  })

  it('recognises the supported provider set', () => {
    expect(isSupportChannelProvider('postmark')).toBe(true)
    expect(isSupportChannelProvider('imap')).toBe(false)
  })
})
