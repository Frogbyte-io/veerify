import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUploadToken, verifyUploadToken } from '../server/utils/upload-token'

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

describe('upload token utility', () => {
  beforeEach(() => {
    installNuxtServerStubs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates and verifies a valid upload token', () => {
    const { token } = createUploadToken(
      {
        projectId: 'project_123',
        userId: 'user_123',
        kind: 'logo',
        tempKey: 'tmp/projects/project_123/logo/file.png',
        contentType: 'image/png',
      },
      60
    )

    const verified = verifyUploadToken(token)
    expect(verified.projectId).toBe('project_123')
    expect(verified.userId).toBe('user_123')
    expect(verified.kind).toBe('logo')
    expect(verified.tempKey).toContain('tmp/projects/project_123/logo')
    expect(verified.contentType).toBe('image/png')
    expect(typeof verified.exp).toBe('number')
  })

  it('rejects tampered upload tokens', () => {
    const { token } = createUploadToken(
      {
        projectId: 'project_123',
        userId: 'user_123',
        kind: 'banner',
        tempKey: 'tmp/projects/project_123/banner/file.png',
        contentType: 'image/png',
      },
      60
    )

    const [payload, signature] = token.split('.')
    const tamperedPayload = `${payload.slice(0, -1)}x`
    const tamperedToken = `${tamperedPayload}.${signature}`

    expect(() => verifyUploadToken(tamperedToken)).toThrow()
  })

  it('rejects expired upload tokens', () => {
    const { token } = createUploadToken(
      {
        projectId: 'project_123',
        userId: 'user_123',
        kind: 'logo',
        tempKey: 'tmp/projects/project_123/logo/file.png',
        contentType: 'image/png',
      },
      -1
    )

    expect(() => verifyUploadToken(token)).toThrow(/expired/i)
  })
})
