import { describe, expect, it, vi, beforeEach } from 'vitest'

const putObject = vi.fn(async () => {})
vi.mock('~/server/utils/storage', () => ({
  getStorageProvider: () => ({ putObject, getObject: async () => Buffer.alloc(0) }),
}))

const {
  ingestInboundAttachments,
  rewriteInlineCidReferences,
  inlineAttachmentPath,
  INBOUND_MAX_ATTACHMENT_BYTES,
  INBOUND_MAX_MESSAGE_ATTACHMENT_BYTES,
} = await import('../server/utils/inbound-attachments')

const { sanitizeInboundHtml } = await import('../server/utils/inbound-sanitize')

function attachment(over: Partial<Parameters<typeof ingestInboundAttachments>[0]['attachments'][number]> = {}) {
  return {
    fileName: 'shot.png',
    contentType: 'image/png',
    content: Buffer.from('bytes'),
    size: 5,
    contentId: null,
    isInline: false,
    ...over,
  }
}

beforeEach(() => {
  putObject.mockClear()
  putObject.mockImplementation(async () => {})
})

describe('ingestInboundAttachments', () => {
  it('stores an attachment and reports its row', async () => {
    const result = await ingestInboundAttachments({
      attachments: [attachment()],
      eventId: 'evt1',
      provider: 'postmark',
    })

    expect(result.stored).toHaveLength(1)
    expect(result.stored[0].sizeBytes).toBe(5)
    expect(result.stored[0].storageKey).toContain('support/attachments/evt1/')
    expect(putObject).toHaveBeenCalledTimes(1)
  })

  it('rejects a single part over the per-attachment cap', async () => {
    const big = attachment({ content: Buffer.alloc(INBOUND_MAX_ATTACHMENT_BYTES + 1) })
    const result = await ingestInboundAttachments({ attachments: [big], eventId: 'e', provider: 'postmark' })

    expect(result.stored).toHaveLength(0)
    expect(result.skipped[0].reason).toBe('attachment-too-large')
    expect(putObject).not.toHaveBeenCalled()
  })

  it('stops at the per-message cap without dropping earlier parts', async () => {
    // Each part must sit under the per-attachment cap, or it is rejected by
    // that rule instead and the message cap is never exercised. Three of these
    // fit individually; the third pushes the running total past the message cap.
    const part = INBOUND_MAX_ATTACHMENT_BYTES - 1
    expect(part * 2).toBeLessThan(INBOUND_MAX_MESSAGE_ATTACHMENT_BYTES)
    expect(part * 3).toBeGreaterThan(INBOUND_MAX_MESSAGE_ATTACHMENT_BYTES)

    const parts = [
      attachment({ fileName: 'a', content: Buffer.alloc(part) }),
      attachment({ fileName: 'b', content: Buffer.alloc(part) }),
      attachment({ fileName: 'c', content: Buffer.alloc(part) }),
    ]

    const result = await ingestInboundAttachments({ attachments: parts, eventId: 'e', provider: 'postmark' })

    expect(result.stored.map((s) => s.fileName)).toEqual(['a', 'b'])
    expect(result.skipped).toEqual([{ fileName: 'c', reason: 'message-cap-exceeded' }])
  })

  it('skips a part with no bytes rather than storing an empty object', async () => {
    const result = await ingestInboundAttachments({
      attachments: [attachment({ content: Buffer.alloc(0) })],
      eventId: 'e',
      provider: 'mailgun',
    })

    expect(result.skipped[0].reason).toBe('no-content')
    expect(putObject).not.toHaveBeenCalled()
  })

  it('drops one failed upload without losing the rest of the email', async () => {
    putObject.mockImplementationOnce(async () => {
      throw new Error('storage down')
    })

    const result = await ingestInboundAttachments({
      attachments: [attachment({ fileName: 'bad' }), attachment({ fileName: 'good' })],
      eventId: 'e',
      provider: 'postmark',
    })

    expect(result.skipped).toEqual([{ fileName: 'bad', reason: 'storage-failed' }])
    expect(result.stored.map((s) => s.fileName)).toEqual(['good'])
  })

  it('maps inline parts by Content-ID', async () => {
    const result = await ingestInboundAttachments({
      attachments: [attachment({ isInline: true, contentId: 'logo@acme' })],
      eventId: 'e',
      provider: 'postmark',
    })

    expect(result.inlineByContentId.get('logo@acme')).toBe(inlineAttachmentPath(result.stored[0].id))
  })
})

describe('rewriteInlineCidReferences', () => {
  const map = new Map([['logo@acme', '/api/support/attachments/att-1']])

  it('rewrites a matching cid reference', () => {
    expect(rewriteInlineCidReferences('<img src="cid:logo@acme">', map)).toBe(
      '<img src="/api/support/attachments/att-1">'
    )
  })

  it('tolerates single quotes and angle brackets', () => {
    expect(rewriteInlineCidReferences("<img src='cid:<logo@acme>'>", map)).toContain('/api/support/attachments/att-1')
  })

  it('leaves an unmatched cid alone for the sanitizer to drop', () => {
    expect(rewriteInlineCidReferences('<img src="cid:missing">', map)).toBe('<img src="cid:missing">')
  })

  it('is a no-op with no inline attachments', () => {
    expect(rewriteInlineCidReferences('<img src="cid:x">', new Map())).toBe('<img src="cid:x">')
    expect(rewriteInlineCidReferences(null, map)).toBeNull()
  })
})

describe('sanitizer img policy (SUP-03-8 boundary)', () => {
  // sanitizeInboundHtml returns null for a body with nothing renderable left,
  // so normalize before asserting on content.
  const clean = (html: string) => sanitizeInboundHtml(html) ?? ''

  it('keeps an img pointing at our own attachment route', () => {
    const html = clean('<img src="/api/support/attachments/abc-123" alt="Logo">')
    expect(html).toContain('/api/support/attachments/abc-123')
    expect(html).toContain('alt="Logo"')
  })

  it('drops a remote img, which would be a tracking pixel', () => {
    // Fires on open and leaks the agent's IP to whoever sent the mail.
    expect(clean('<img src="https://evil.test/pixel.gif">')).not.toContain('img')
  })

  it('drops an unresolved cid img', () => {
    expect(clean('<img src="cid:never-arrived">')).not.toContain('img')
  })

  it('refuses an absolute URL that merely contains the attachment path', () => {
    // The prefix test is anchored, so this must not pass as same-origin.
    expect(clean('<img src="https://evil.test/api/support/attachments/x">')).not.toContain('img')
  })

  it('refuses a protocol-relative lookalike and a traversal', () => {
    expect(clean('<img src="//evil.test/api/support/attachments/x">')).not.toContain('img')
    expect(clean('<img src="/api/support/attachments/../../etc/passwd">')).not.toContain('img')
  })

  it('still blocks script and event handlers on an allowed img', () => {
    const html = clean('<img src="/api/support/attachments/abc" onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })
})
