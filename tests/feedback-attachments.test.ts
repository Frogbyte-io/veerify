import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  buildFeedbackAttachmentDownloadUrl,
  decideAttachmentAccess,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  processFeedbackAttachment,
  signFeedbackAttachmentUploadToken,
  sniffFeedbackAttachment,
  validateFeedbackAttachmentRequest,
  verifyFeedbackAttachmentDownloadSignature,
  verifyFeedbackAttachmentUploadToken,
} from '../server/utils/feedback-attachments'

function installStubs() {
  vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'unit-test-secret' }))
  vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input?.data?.error?.message ?? 'err'), input))
}

async function png(width = 8, height = 6) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()
}

function expectRejected(fn: () => unknown, message?: RegExp) {
  try {
    fn()
  } catch (error: any) {
    expect(error.statusCode).toBe(400)
    if (message) expect(error.message).toMatch(message)
    return
  }
  throw new Error('expected rejection')
}

describe('feedback attachment validation', () => {
  beforeEach(installStubs)
  afterEach(() => vi.unstubAllGlobals())

  it('exposes the documented limits', () => {
    expect(FEEDBACK_ATTACHMENT_MAX_COUNT).toBe(5)
    expect(FEEDBACK_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('accepts allowlisted requests and rejects disallowed types at presign', () => {
    expect(validateFeedbackAttachmentRequest('shot.png', 'image/png', 100)).toBe('image/png')
    expect(validateFeedbackAttachmentRequest('app.log', 'application/octet-stream', 100)).toBe(
      'application/octet-stream'
    )
    expect(validateFeedbackAttachmentRequest('report.pdf', 'application/pdf', 100)).toBe('application/pdf')
    expectRejected(() => validateFeedbackAttachmentRequest('logo.svg', 'image/svg+xml', 100))
    expectRejected(() => validateFeedbackAttachmentRequest('page.html', 'text/html', 100))
    expectRejected(() => validateFeedbackAttachmentRequest('setup.exe', 'application/octet-stream', 100))
    expectRejected(() => validateFeedbackAttachmentRequest('logo.svg', 'image/png', 100), /extension/)
    expectRejected(() => validateFeedbackAttachmentRequest('a.png', 'image/png', 0))
  })

  it('enforces the 10 MB cap', () => {
    expect(() => validateFeedbackAttachmentRequest('a.png', 'image/png', FEEDBACK_ATTACHMENT_MAX_BYTES)).not.toThrow()
    expectRejected(
      () => validateFeedbackAttachmentRequest('a.png', 'image/png', FEEDBACK_ATTACHMENT_MAX_BYTES + 1),
      /too large/
    )
    const big = Buffer.alloc(FEEDBACK_ATTACHMENT_MAX_BYTES + 1, 0x61)
    expectRejected(() => sniffFeedbackAttachment(big, 'big.txt'), /too large/)
  })

  it('sniffs real images and ignores a misleading extension', async () => {
    const data = await png()
    expect(sniffFeedbackAttachment(data, 'a.png', 'image/png')).toMatchObject({
      contentType: 'image/png',
      kind: 'image',
    })
    // Same bytes named .jpg: content/extension mismatch is rejected rather than trusted
    expectRejected(() => sniffFeedbackAttachment(data, 'a.jpg', 'image/jpeg'))
    // Bytes that are not an image never pass because of an image extension
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('just text'), 'a.png', 'image/png'))
    // GIF / WebP / JPEG / PDF magic
    expect(sniffFeedbackAttachment(Buffer.from('GIF89a......'), 'a.gif').contentType).toBe('image/gif')
    expect(sniffFeedbackAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'a.jpeg').contentType).toBe(
      'image/jpeg'
    )
    expect(
      sniffFeedbackAttachment(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'a.webp')
        .contentType
    ).toBe('image/webp')
    expect(sniffFeedbackAttachment(Buffer.from('%PDF-1.7\n...'), 'a.pdf', 'application/pdf')).toMatchObject({
      contentType: 'application/pdf',
      kind: 'file',
    })
  })

  it('rejects declared-type mismatches (png declared, pdf bytes)', () => {
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('%PDF-1.7'), 'a.pdf', 'image/png'), /declared type/)
  })

  it('accepts plain-text logs and validates JSON', () => {
    expect(
      sniffFeedbackAttachment(Buffer.from('2026-01-01 ERROR boom\n\tat x\n'), 'app.log', 'application/octet-stream')
    ).toMatchObject({
      contentType: 'text/plain',
      kind: 'log',
    })
    expect(sniffFeedbackAttachment(Buffer.from('{"a":1}'), 'trace.json', 'application/json').contentType).toBe(
      'application/json'
    )
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('{not json'), 'trace.json'), /JSON/)
  })

  it('rejects SVG, HTML, executables, archives and binary-as-text', () => {
    expectRejected(() =>
      sniffFeedbackAttachment(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.txt')
    )
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'), 'a.log'))
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('  <html><body></body></html>'), 'a.txt'))
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('<svg></svg>'), 'a.svg'))
    expectRejected(() => sniffFeedbackAttachment(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'a.log'), /not allowed/)
    expectRejected(() => sniffFeedbackAttachment(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1]), 'a.txt'), /not allowed/)
    expectRejected(() => sniffFeedbackAttachment(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'a.txt'), /not allowed/)
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('#!/bin/sh\nrm -rf /'), 'a.txt'))
    expectRejected(() => sniffFeedbackAttachment(Buffer.from([0x61, 0x00, 0x62]), 'a.log'), /plain UTF-8/)
    expectRejected(() => sniffFeedbackAttachment(Buffer.from('x'), 'a.sh'))
    expectRejected(() => sniffFeedbackAttachment(Buffer.alloc(0), 'a.txt'))
  })

  it('strips EXIF when re-encoding JPEG and reports dimensions', async () => {
    const withExif = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#aa0000' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .toBuffer()
    expect((await sharp(withExif).metadata()).exif).toBeTruthy()

    const result = await processFeedbackAttachment(withExif, 'photo.jpg', 'image/jpeg')
    expect(result.rewritten).toBe(true)
    expect(result.width).toBe(20)
    expect(result.height).toBe(10)
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined()
  })

  it('rejects an image whose bytes carry valid magic but do not decode', async () => {
    const truncated = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
    await expect(processFeedbackAttachment(truncated, 'bad.png', 'image/png')).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('passes logs through untouched', async () => {
    const buffer = Buffer.from('line one\nline two')
    const result = await processFeedbackAttachment(buffer, 'out.txt', 'text/plain')
    expect(result).toMatchObject({ kind: 'log', rewritten: false, width: null })
    expect(result.buffer).toBe(buffer)
  })
})

describe('feedback attachment authorization matrix', () => {
  const base = {
    isTeamMember: false,
    isAuthor: false,
    projectIsPublic: true,
    feedbackIsHidden: false,
    feedbackIsSupportDerived: false,
  }

  it('anonymous visitor on a public product sees visible feedback only, read-only', () => {
    expect(decideAttachmentAccess(base)).toEqual({ canView: true, canUpload: false, canDelete: false })
  })

  it('anonymous visitor on a private product sees nothing', () => {
    expect(decideAttachmentAccess({ ...base, projectIsPublic: false }).canView).toBe(false)
  })

  it('hidden feedback is not visible to public visitors', () => {
    expect(decideAttachmentAccess({ ...base, feedbackIsHidden: true }).canView).toBe(false)
  })

  it('support-derived feedback is never visible on the public board', () => {
    expect(decideAttachmentAccess({ ...base, feedbackIsSupportDerived: true }).canView).toBe(false)
    expect(decideAttachmentAccess({ ...base, feedbackIsSupportDerived: true, feedbackIsHidden: true }).canView).toBe(
      false
    )
  })

  it('team members can always view, add and delete (private, hidden, support-derived)', () => {
    const team = {
      ...base,
      isTeamMember: true,
      projectIsPublic: false,
      feedbackIsHidden: true,
      feedbackIsSupportDerived: true,
    }
    expect(decideAttachmentAccess(team)).toEqual({ canView: true, canUpload: true, canDelete: true })
  })

  it('the author can view, add and delete their own attachments even when hidden', () => {
    expect(decideAttachmentAccess({ ...base, isAuthor: true, feedbackIsHidden: true })).toEqual({
      canView: true,
      canUpload: true,
      canDelete: true,
    })
  })

  it('a non-author, non-member cannot upload or delete', () => {
    const access = decideAttachmentAccess(base)
    expect(access.canUpload).toBe(false)
    expect(access.canDelete).toBe(false)
  })
})

describe('signed URLs', () => {
  beforeEach(installStubs)
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function parse(url: string) {
    const parsed = new URL(url, 'http://localhost')
    return {
      id: decodeURIComponent(parsed.pathname.split('/')[3]),
      exp: parsed.searchParams.get('exp'),
      sig: parsed.searchParams.get('sig'),
    }
  }

  it('verifies a freshly minted URL for its own attachment only', () => {
    const { url } = buildFeedbackAttachmentDownloadUrl('att-1')
    const { id, exp, sig } = parse(url)
    expect(id).toBe('att-1')
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, sig)).toBe(true)
    // scoped to the attachment id
    expect(verifyFeedbackAttachmentDownloadSignature('att-2', exp, sig)).toBe(false)
  })

  it('rejects tampered expiry, tampered signature and missing parts', () => {
    const { url } = buildFeedbackAttachmentDownloadUrl('att-1')
    const { exp, sig } = parse(url)
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', String(Number(exp) + 3600), sig)).toBe(false)
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, `${sig}x`)).toBe(false)
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, undefined)).toBe(false)
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', undefined, sig)).toBe(false)
  })

  it('expires after the short TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { url, expiresAt } = buildFeedbackAttachmentDownloadUrl('att-1')
    expect(expiresAt.getTime() - Date.now()).toBe(5 * 60 * 1000)
    const { exp, sig } = parse(url)
    vi.setSystemTime(new Date('2026-01-01T00:04:00Z'))
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, sig)).toBe(true)
    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'))
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, sig)).toBe(false)
  })

  it('does not accept an upload token as a download signature (purpose separation)', () => {
    const token = signFeedbackAttachmentUploadToken('att-1', new Date(Date.now() + 60_000))
    const [, exp, sig] = token.split('.')
    expect(verifyFeedbackAttachmentDownloadSignature('att-1', exp, sig)).toBe(false)
  })

  it('round-trips and rejects bad upload tokens', () => {
    const token = signFeedbackAttachmentUploadToken('att-1', new Date(Date.now() + 60_000))
    expect(verifyFeedbackAttachmentUploadToken(token).attachmentId).toBe('att-1')
    expect(() => verifyFeedbackAttachmentUploadToken(token.replace('att-1', 'att-2'))).toThrow()
    expect(() => verifyFeedbackAttachmentUploadToken('garbage')).toThrow()
    const expired = signFeedbackAttachmentUploadToken('att-1', new Date(Date.now() - 1000))
    expect(() => verifyFeedbackAttachmentUploadToken(expired)).toThrow()
  })
})
