import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  SUPPORT_MAX_ATTACHMENT_BYTES,
  signSupportUploadToken,
  createSupportUploadTempKey,
  createSupportAttachmentFinalKey,
  validateAttachmentUploadInput,
  verifySupportUploadToken,
} from '../server/utils/support-attachments'

function installNuxtServerStubs() {
  vi.stubGlobal('useRuntimeConfig', () => ({
    uploadTokenSecret: 'unit-test-upload-secret',
  }))
  vi.stubGlobal('createError', (input: any) => {
    const message = input?.data?.error?.message || input?.statusMessage || 'Request failed'
    const err = new Error(message) as any
    Object.assign(err, input)
    return err
  })
}

describe('validateAttachmentUploadInput', () => {
  beforeEach(installNuxtServerStubs)
  afterEach(() => vi.unstubAllGlobals())

  it('accepts every type in the allowlist at the size cap', () => {
    for (const contentType of ALLOWED_ATTACHMENT_CONTENT_TYPES) {
      expect(() => validateAttachmentUploadInput(contentType, SUPPORT_MAX_ATTACHMENT_BYTES)).not.toThrow()
    }
  })

  it('rejects a type outside the allowlist', () => {
    expect(() => validateAttachmentUploadInput('text/html', 1024)).toThrow(/unsupported/i)
  })

  it('rejects a file over the per-part cap', () => {
    expect(() => validateAttachmentUploadInput('application/pdf', SUPPORT_MAX_ATTACHMENT_BYTES + 1)).toThrow(
      /too large/i
    )
  })

  it('rejects a non-positive size', () => {
    expect(() => validateAttachmentUploadInput('application/pdf', 0)).toThrow()
  })
})

describe('signSupportUploadToken / verifySupportUploadToken', () => {
  beforeEach(installNuxtServerStubs)
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips a valid token', () => {
    const expiresAt = new Date(Date.now() + 60_000)
    const token = signSupportUploadToken({ uploadId: 'upload_1', expiresAt })

    const verified = verifySupportUploadToken(token)
    expect(verified.uploadId).toBe('upload_1')
    expect(verified.expiresAt.getTime()).toBe(Math.floor(expiresAt.getTime() / 1000) * 1000)
    expect(token).not.toContain('storageKey')
  })

  it('rejects a tampered token', () => {
    const token = signSupportUploadToken({ uploadId: 'upload_1', expiresAt: new Date(Date.now() + 60_000) })

    const [payload, signature] = token.split('.')
    const tamperedToken = `${payload.slice(0, -1)}x.${signature}`
    expect(() => verifySupportUploadToken(tamperedToken)).toThrow(/signature/i)
  })

  it('rejects an expired token input', () => {
    expect(() => signSupportUploadToken({ uploadId: 'upload_1', expiresAt: new Date(Date.now() - 1_000) })).toThrow(/invalid/i)
  })
})

describe('server-owned attachment keys', () => {
  it('keeps temporary and final namespaces separate', () => {
    expect(createSupportUploadTempKey('upload_1', '../../invoice.pdf')).toBe(
      'support/attachments/uploads/upload_1/invoice.pdf'
    )
    expect(createSupportAttachmentFinalKey('attachment_1', 'invoice.pdf')).toBe(
      'support/attachments/outbound/attachment_1/invoice.pdf'
    )
  })
})
