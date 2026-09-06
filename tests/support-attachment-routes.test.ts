import { Readable } from 'node:stream'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: { conversationId: 'conversation-1', filename: 'file.txt', contentType: 'text/plain', sizeBytes: 5 },
  session: { user: { id: 'user-1' } },
  row: {
    id: 'upload-1',
    conversationId: 'conversation-1',
    userId: 'user-1',
    tempStorageKey: 'support/attachments/uploads/upload-1/file.txt',
    fileName: 'file.txt',
    requestedContentType: 'text/plain',
    requestedSizeBytes: 5,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    objectVersion: undefined as string | undefined,
    uploadedAt: undefined as Date | undefined,
  },
  provider: {
    driver: 'local',
    directUploadConstraints: 'proxy-required',
    getPresignedUploadTarget: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    headObject: vi.fn(),
  },
  insert: vi.fn(),
  insertedValues: undefined as Record<string, unknown> | undefined,
  update: vi.fn(),
  select: vi.fn(),
  conversationError: null as Error | null,
}))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => {
    if (!state.session) throw Object.assign(new Error('Authentication required'), { statusCode: 401 })
    return state.session
  }),
}))
vi.mock('~/server/utils/support-access', () => ({
  requireConversationAccess: vi.fn(async () => {
    if (state.conversationError) throw state.conversationError
    return {}
  }),
}))
vi.mock('~/server/utils/storage', () => ({ getStorageProvider: vi.fn(() => state.provider) }))
vi.mock('~/server/utils/validation', () => ({ validateBody: vi.fn(async () => state.body) }))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    insert: (...args: unknown[]) => state.insert(...args),
    update: (...args: unknown[]) => state.update(...args),
    select: (...args: unknown[]) => state.select(...args),
    transaction: async (fn: (tx: any) => unknown) => fn({ insert: state.insert, update: state.update, select: state.select }),
  },
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input?.statusMessage || 'Request failed'), input))
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getRouterParam', () => 'opaque-token')
vi.stubGlobal('getHeader', () => 'text/plain')

function chain(result: unknown) {
  const value = {
    values: vi.fn((input: Record<string, unknown>) => {
      state.insertedValues = input
      return value
    }),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
    from: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
  return value
}

const presign = (await import('../server/api/support/attachments/presign.post')).default
const upload = (await import('../server/api/support/attachments/upload/[token].put')).default
const complete = (await import('../server/api/support/attachments/[uploadId]/complete.post')).default

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input?.statusMessage || 'Request failed'), input))
  vi.stubGlobal('readBody', async () => state.body)
  vi.stubGlobal('getRouterParam', () => 'opaque-token')
  vi.stubGlobal('getHeader', () => 'text/plain')
  vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'test-secret' }))
  state.provider.driver = 'local'
  state.provider.directUploadConstraints = 'proxy-required'
  state.row.status = 'pending'
  state.row.objectVersion = undefined
  state.row.uploadedAt = undefined
  state.row.userId = 'user-1'
  state.row.expiresAt = new Date(Date.now() + 60_000)
  state.insert.mockReturnValue(chain([state.row]))
  state.insertedValues = undefined
  state.update.mockReturnValue(chain([state.row]))
  state.select.mockReturnValue(chain([state.row]))
  state.provider.putObject.mockReset().mockResolvedValue(undefined)
  state.provider.deleteObject.mockReset().mockResolvedValue(undefined)
  state.provider.headObject.mockReset().mockResolvedValue({ sizeBytes: 5, contentType: 'text/plain', objectVersion: 'version-1' })
  state.session = { user: { id: 'user-1' } }
  state.conversationError = null
  state.body = { conversationId: 'conversation-1', filename: 'file.txt', contentType: 'text/plain', sizeBytes: 5 }
})

describe('attachment presign route', () => {
  it('returns a proxy target with an opaque upload id and no storage key', async () => {
    const result = await presign({} as never)
    expect(result.data).toMatchObject({ method: 'PUT', fileName: 'file.txt', contentType: 'text/plain' })
    expect(result.data).toHaveProperty('uploadId')
    expect(result.data).not.toHaveProperty('storageKey')
    expect(result.data.uploadUrl).toMatch(/^\/api\/support\/attachments\/upload\//)
    expect(state.insertedValues).toMatchObject({
      conversationId: 'conversation-1',
      userId: 'user-1',
      status: 'pending',
      finalStorageKey: null,
    })
    expect(state.insertedValues?.tempStorageKey).toMatch(/^support\/attachments\/uploads\//)
  })

  it.each([
    ['invalid MIME', { contentType: 'text/html', sizeBytes: 5 }],
    ['declared over-limit size', { contentType: 'text/plain', sizeBytes: 10 * 1024 * 1024 + 1 }],
  ])('rejects %s before creating a session', async (_label, overrides) => {
    state.body = { ...state.body, ...overrides }
    await expect(presign({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.insert).not.toHaveBeenCalled()
  })

  it('requires authentication and conversation access', async () => {
    state.session = null as any
    await expect(presign({} as never)).rejects.toMatchObject({ statusCode: 401 })
    state.session = { user: { id: 'user-1' } }
    state.conversationError = Object.assign(new Error('forbidden'), { statusCode: 403 })
    await expect(presign({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.insert).not.toHaveBeenCalled()
  })

  it('selects direct S3 only when the provider proves signed length enforcement', async () => {
    state.provider.driver = 's3'
    state.provider.directUploadConstraints = 'content-length-enforced'
    state.provider.getPresignedUploadTarget.mockResolvedValue({ uploadUrl: 'https://s3.test/signed', method: 'PUT', headers: { 'content-type': 'text/plain' } })
    const result = await presign({} as never)
    expect(result.data.uploadUrl).toBe('https://s3.test/signed')
    expect(state.provider.getPresignedUploadTarget).toHaveBeenCalledWith(
      expect.stringContaining('support/attachments/uploads/'), 'text/plain', expect.any(Number), { expectedSizeBytes: 5 }
    )
  })
})

describe('bounded proxy upload route', () => {
  it('streams and stores a bounded body without readRawBody', async () => {
    const chunks = [Buffer.from('he'), Buffer.from('llo')]
    const event = {
      node: { req: Readable.from(chunks) },
      context: {},
      headers: { 'content-type': 'text/plain' },
      params: { token: 'opaque-token' },
    } as never
    vi.stubGlobal('getRouterParam', () => 'opaque-token')
    vi.stubGlobal('getHeader', () => 'text/plain')
    vi.stubGlobal('readRawBody', () => { throw new Error('readRawBody must not be called') })
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })

    await expect(upload(event)).resolves.toMatchObject({ data: { uploaded: true, uploadId: 'upload-1', sizeBytes: 5 } })
    expect(state.provider.putObject).toHaveBeenCalledWith(expect.objectContaining({ key: state.row.tempStorageKey, contentType: 'text/plain' }))
  })

  it('stops consuming immediately after the first byte over 10 MB', async () => {
    const chunks = [Buffer.alloc(10 * 1024 * 1024), Buffer.from('x'), Buffer.from('should-not-be-consumed')]
    let consumed = 0
    const stream = {
      pause: vi.fn(),
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            const value = chunks[consumed++]
            return value ? { value, done: false } : { value: undefined, done: true }
          },
        }
      },
    }
    const event = { node: { req: stream }, context: {}, params: { token: 'opaque-token' } } as never
    vi.stubGlobal('getRouterParam', () => 'opaque-token')
    vi.stubGlobal('getHeader', () => 'text/plain')
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })

    await expect(upload(event)).rejects.toMatchObject({ statusCode: 413 })
    expect(consumed).toBe(2)
    expect(state.provider.putObject).not.toHaveBeenCalled()
  })

  it('rejects a repeated local upload token after the session is uploaded', async () => {
    state.row.status = 'uploaded'
    const event = { node: { req: Readable.from([Buffer.from('hello')]) }, context: {}, params: { token: 'opaque-token' } } as never
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })
    await expect(upload(event)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.provider.putObject).not.toHaveBeenCalled()
  })

  it('rejects an expired session before consuming its body', async () => {
    state.row.expiresAt = new Date(Date.now() - 1_000)
    const event = { node: { req: Readable.from([Buffer.from('hello')]) }, context: {}, params: { token: 'opaque-token' } } as never
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: new Date(Date.now() + 60_000) })
    await expect(upload(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.provider.putObject).not.toHaveBeenCalled()
  })

  it('rejects a proxy content-type mismatch before consuming the body', async () => {
    vi.stubGlobal('getHeader', () => 'application/pdf')
    const event = { node: { req: Readable.from([Buffer.from('hello')]) }, context: {}, params: { token: 'opaque-token' } } as never
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })

    await expect(upload(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.provider.putObject).not.toHaveBeenCalled()
  })

  it('deletes stored bytes when the actual proxy size differs from the declaration', async () => {
    state.provider.headObject.mockResolvedValue({ sizeBytes: 4, contentType: 'text/plain', objectVersion: 'version-1' })
    const event = { node: { req: Readable.from([Buffer.from('four')]) }, context: {}, params: { token: 'opaque-token' } } as never
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })

    await expect(upload(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.provider.putObject).toHaveBeenCalledOnce()
    expect(state.provider.deleteObject).toHaveBeenCalledWith(state.row.tempStorageKey)
    expect(state.update).not.toHaveBeenCalled()
  })

  it('removes the temporary file when the storage provider fails', async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('veerify-attachment-')).sort()
    state.provider.putObject.mockRejectedValueOnce(new Error('storage unavailable'))
    const event = { node: { req: Readable.from([Buffer.from('hello')]) }, context: {}, params: { token: 'opaque-token' } } as never
    const tokenModule = await import('../server/utils/support-attachments')
    vi.spyOn(tokenModule, 'verifySupportUploadToken').mockReturnValue({ uploadId: 'upload-1', expiresAt: state.row.expiresAt })

    await expect(upload(event)).rejects.toThrow('storage unavailable')
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('veerify-attachment-')).sort()
    expect(after).toEqual(before)
    expect(state.update).not.toHaveBeenCalled()
  })
})

describe('direct upload completion route', () => {
  beforeEach(() => {
    state.provider.driver = 's3'
    state.provider.directUploadConstraints = 'content-length-enforced'
  })

  it('verifies metadata and returns idempotent completion details', async () => {
    state.row.status = 'pending'
    state.row.objectVersion = undefined
    vi.stubGlobal('getRouterParam', () => 'upload-1')
    const event = { params: { uploadId: 'upload-1' } } as never

    await expect(complete(event)).resolves.toMatchObject({
      data: { uploaded: true, uploadId: 'upload-1', objectVersion: 'version-1', sizeBytes: 5 },
    })
    expect(state.update).toHaveBeenCalled()
  })

  it('rejects a changed object on repeated completion', async () => {
    state.row.status = 'uploaded'
    state.row.objectVersion = 'version-1'
    state.row.uploadedAt = new Date()
    state.provider.headObject.mockResolvedValue({ sizeBytes: 5, contentType: 'text/plain', objectVersion: 'version-2' })
    vi.stubGlobal('getRouterParam', () => 'upload-1')

    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns the same result when an unchanged object is completed again', async () => {
    state.row.status = 'uploaded'
    state.row.objectVersion = 'version-1'
    state.row.uploadedAt = new Date()

    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).resolves.toMatchObject({
      data: { uploaded: true, uploadId: 'upload-1', objectVersion: 'version-1' },
    })
  })

  it('rejects a foreign owner and missing object', async () => {
    state.row.userId = 'user-2'
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 404 })
    state.row.userId = 'user-1'
    state.provider.headObject.mockRejectedValue(Object.assign(new Error('missing'), { code: 'OBJECT_NOT_FOUND' }))
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a foreign conversation and an expired direct session', async () => {
    state.conversationError = Object.assign(new Error('forbidden'), { statusCode: 403 })
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 403 })
    state.conversationError = null
    state.row.expiresAt = new Date(Date.now() - 1_000)
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.provider.headObject).not.toHaveBeenCalled()
  })

  it.each([
    ['actual size', { sizeBytes: 6, contentType: 'text/plain', objectVersion: 'version-1' }],
    ['oversized actual object', { sizeBytes: 10 * 1024 * 1024 + 1, contentType: 'text/plain', objectVersion: 'version-1' }],
    ['actual type', { sizeBytes: 5, contentType: 'application/pdf', objectVersion: 'version-1' }],
    ['missing actual type', { sizeBytes: 5, contentType: null, objectVersion: 'version-1' }],
  ])('rejects an object with mismatched %s', async (_label, metadata) => {
    state.provider.headObject.mockResolvedValue(metadata)
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects completion for a proxy-only provider', async () => {
    state.provider.driver = 'local'
    state.provider.directUploadConstraints = 'proxy-required'
    await expect(complete({ params: { uploadId: 'upload-1' } } as never)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.provider.headObject).not.toHaveBeenCalled()
  })
})
