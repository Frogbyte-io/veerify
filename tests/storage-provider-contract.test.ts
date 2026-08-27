import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { LocalStorageProvider } from '../server/utils/storage/provider-local'
import { S3StorageProvider } from '../server/utils/storage/provider-s3'

describe('local storage provider contract', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('returns a SHA-256 version and conditionally copies objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veerify-storage-'))
    roots.push(root)
    const storage = new LocalStorageProvider({ rootDir: root })
    await storage.putObject({ key: 'uploads/source', buffer: Buffer.from('four'), contentType: 'text/plain' })
    const version = createHash('sha256').update('four').digest('hex')

    expect(storage.directUploadConstraints).toBe('proxy-required')
    expect(await storage.headObject('uploads/source')).toEqual({
      sizeBytes: 4,
      contentType: null,
      objectVersion: version,
    })
    await expect(
      storage.copyObject('uploads/source', 'final/file', { contentType: 'text/plain', ifMatch: 'wrong-version' })
    ).rejects.toMatchObject({ code: 'OBJECT_VERSION_MISMATCH' })
    expect(await storage.copyObject('uploads/source', 'final/file', { contentType: 'text/plain', ifMatch: version })).toEqual({
      sizeBytes: 4,
      contentType: 'text/plain',
      objectVersion: version,
    })
  })
})

describe('S3 storage provider contract', () => {
  it('heads objects and uses a conditional copy', async () => {
    const storage = new S3StorageProvider({
      bucket: 'bucket',
      region: 'us-east-1',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ContentLength: 4, ContentType: 'text/plain', VersionId: 'version-1', ETag: '"etag"' })
      .mockResolvedValueOnce({ ContentLength: 4, ContentType: 'text/plain', ETag: '"version-1"' })
      .mockResolvedValueOnce({ CopyObjectResult: { Size: 4, ETag: '"etag-2"' } })
      .mockResolvedValueOnce({ ContentLength: 4, ContentType: 'application/pdf', ETag: '"etag-destination"' })
    ;(storage as any).client.send = send

    expect(storage.directUploadConstraints).toBe('proxy-required')
    expect(await storage.headObject('source')).toEqual({
      sizeBytes: 4,
      contentType: 'text/plain',
      objectVersion: 'version-1',
    })
    expect(await storage.copyObject('source', 'destination', { contentType: 'application/pdf', ifMatch: 'version-1' })).toMatchObject({
      sizeBytes: 4,
      contentType: 'application/pdf',
      objectVersion: 'etag-destination',
    })
    expect(send).toHaveBeenCalledTimes(4)
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
    expect(send.mock.calls[2][0]).toBeInstanceOf(CopyObjectCommand)
    expect(send.mock.calls[2][0].input).toMatchObject({
      CopySource: 'bucket/source',
      Key: 'destination',
      ContentType: 'application/pdf',
      CopySourceIfMatch: 'version-1',
    })
  })

  it('pins a versioned source in CopySource instead of treating a version id as an ETag', async () => {
    const storage = new S3StorageProvider({
      bucket: 'bucket',
      region: 'us-east-1',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ContentLength: 4, ContentType: 'text/plain', VersionId: 'version/one', ETag: '"etag"' })
      .mockResolvedValueOnce({ CopyObjectResult: { ETag: '"etag-2"' } })
      .mockResolvedValueOnce({ ContentLength: 4, ContentType: 'text/plain', VersionId: 'version-two', ETag: '"etag-2"' })
    ;(storage as any).client.send = send

    await expect(
      storage.copyObject('folder/source file', 'destination', { contentType: 'text/plain', ifMatch: 'version/one' })
    ).resolves.toMatchObject({ objectVersion: 'version-two' })
    expect(send.mock.calls[1][0]).toBeInstanceOf(CopyObjectCommand)
    expect(send.mock.calls[1][0].input).toMatchObject({
      CopySource: 'bucket/folder/source%20file?versionId=version%2Fone',
      Key: 'destination',
    })
    expect(send.mock.calls[1][0].input).not.toHaveProperty('CopySourceIfMatch')
  })

  it('defaults custom S3 targets to proxy-required uploads', () => {
    const storage = new S3StorageProvider({
      bucket: 'bucket',
      region: 'auto',
      endpoint: 'https://r2.example.test',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
    expect(storage.directUploadConstraints).toBe('proxy-required')
  })

  it('only advertises direct uploads when the signed URL includes content length', async () => {
    const storage = new S3StorageProvider({
      bucket: 'bucket',
      region: 'us-east-1',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      directUploadConstraints: 'content-length-enforced',
    })
    const target = await storage.getPresignedUploadTarget('source', 'text/plain', 60, { expectedSizeBytes: 4 })
    const signedHeaders = new URL(target.uploadUrl).searchParams.get('X-Amz-SignedHeaders') || ''
    expect(signedHeaders.split(';')).toContain('content-length')
    expect(target.headers).not.toHaveProperty('content-length')
  })

  it('fails closed when constrained direct uploads omit the expected size', async () => {
    const storage = new S3StorageProvider({
      bucket: 'bucket',
      region: 'us-east-1',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      directUploadConstraints: 'content-length-enforced',
    })
    await expect(storage.getPresignedUploadTarget('source', 'text/plain', 60)).rejects.toThrow(/expected object size/i)
  })
})

describe('server-owned attachment token', () => {
  it('contains only the upload id and expiry', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'test-secret' }))
    const { signSupportUploadToken, verifySupportUploadToken } = await import('../server/utils/support-attachments')
    const expiresAt = new Date(Date.now() + 60_000)
    const token = signSupportUploadToken({ uploadId: randomUUID(), expiresAt })
    const payload = verifySupportUploadToken(token)
    expect(payload.uploadId).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.expiresAt.getTime()).toBe(Math.floor(expiresAt.getTime() / 1000) * 1000)
    expect(token).not.toContain('conversation')
    expect(token).not.toContain('storage')
    vi.unstubAllGlobals()
  })
})
