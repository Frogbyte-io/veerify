import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  SUPPORT_MAX_ATTACHMENT_BYTES,
  buildOutboundAttachmentStorageKey,
  createAttachmentUploadToken,
  validateAttachmentUploadInput,
  verifyAttachmentUploadToken,
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

describe('buildOutboundAttachmentStorageKey', () => {
  it('keys by conversation, attachment id, and a sanitized filename', () => {
    const key = buildOutboundAttachmentStorageKey('conv_1', 'att_1', 'Invoice (final).pdf')
    expect(key).toBe('support/attachments/outbound/conv_1/att_1/Invoice-final-.pdf')
  })

  it('strips a path from the filename rather than nesting it', () => {
    const key = buildOutboundAttachmentStorageKey('conv_1', 'att_1', '../../etc/passwd')
    expect(key).toBe('support/attachments/outbound/conv_1/att_1/passwd')
  })
})

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

describe('createAttachmentUploadToken / verifyAttachmentUploadToken', () => {
  beforeEach(installNuxtServerStubs)
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips a valid token', () => {
    const { token } = createAttachmentUploadToken(
      {
        conversationId: 'conv_1',
        userId: 'user_1',
        storageKey: 'support/attachments/outbound/conv_1/att_1/file.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      },
      60
    )

    const verified = verifyAttachmentUploadToken(token)
    expect(verified.conversationId).toBe('conv_1')
    expect(verified.userId).toBe('user_1')
    expect(verified.storageKey).toBe('support/attachments/outbound/conv_1/att_1/file.pdf')
    expect(verified.contentType).toBe('application/pdf')
    expect(verified.sizeBytes).toBe(1024)
  })

  it('rejects a tampered token', () => {
    const { token } = createAttachmentUploadToken(
      {
        conversationId: 'conv_1',
        userId: 'user_1',
        storageKey: 'support/attachments/outbound/conv_1/att_1/file.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      },
      60
    )

    const [payload, signature] = token.split('.')
    const tamperedToken = `${payload.slice(0, -1)}x.${signature}`
    expect(() => verifyAttachmentUploadToken(tamperedToken)).toThrow()
  })

  it('rejects an expired token', () => {
    const { token } = createAttachmentUploadToken(
      {
        conversationId: 'conv_1',
        userId: 'user_1',
        storageKey: 'support/attachments/outbound/conv_1/att_1/file.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      },
      -1
    )

    expect(() => verifyAttachmentUploadToken(token)).toThrow(/expired/i)
  })
})
