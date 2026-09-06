import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StorageProvider, PutObjectInput, PresignedUploadTarget, StorageObjectMetadata, CopyObjectOptions } from './types'

export interface LocalStorageProviderOptions {
  rootDir: string
  publicBaseUrl?: string
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeKey(key: string) {
  const normalized = trimSlashes(key.replace(/\\/g, '/'))
  if (!normalized || normalized.includes('..')) {
    throw new Error('Invalid object key')
  }
  return normalized
}

function toUploadObjectUrl(baseUrl: string | undefined, token: string) {
  const encodedToken = encodeURIComponent(token)
  if (!baseUrl) {
    return `/api/uploads/temp/${encodedToken}`
  }
  return `${baseUrl.replace(/\/+$/g, '')}/api/uploads/temp/${encodedToken}`
}

function toPublicObjectUrl(baseUrl: string | undefined, key: string) {
  const encodedKey = normalizeKey(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  if (!baseUrl) {
    return `/api/uploads/object/${encodedKey}`
  }
  return `${baseUrl.replace(/\/+$/g, '')}/api/uploads/object/${encodedKey}`
}

export class LocalStorageProvider implements StorageProvider {
  readonly driver = 'local' as const
  readonly directUploadConstraints = 'proxy-required' as const
  private readonly rootDir: string
  private readonly publicBaseUrl?: string

  constructor(options: LocalStorageProviderOptions) {
    this.rootDir = resolve(process.cwd(), options.rootDir)
    this.publicBaseUrl = options.publicBaseUrl
  }

  private resolvePathForKey(key: string) {
    const normalized = normalizeKey(key)
    return {
      normalized,
      absolute: join(this.rootDir, normalized),
    }
  }

  async getPresignedUploadTarget(
    token: string,
    contentType: string,
    expiresSeconds: number
  ): Promise<PresignedUploadTarget> {
    void expiresSeconds
    return {
      uploadUrl: toUploadObjectUrl(this.publicBaseUrl, token),
      method: 'PUT',
      headers: {
        'content-type': contentType,
      },
    }
  }

  async headObject(key: string): Promise<StorageObjectMetadata> {
    const pathInfo = this.resolvePathForKey(key)
    let bytes: Buffer
    try {
      bytes = await readFile(pathInfo.absolute)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const missing = new Error('Object not found') as Error & { code?: string }
        missing.code = 'OBJECT_NOT_FOUND'
        throw missing
      }
      throw error
    }
    return {
      sizeBytes: bytes.byteLength,
      contentType: null,
      objectVersion: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  async copyObject(sourceKey: string, destinationKey: string, options: CopyObjectOptions): Promise<StorageObjectMetadata> {
    const sourcePath = this.resolvePathForKey(sourceKey)
    const bytes = await readFile(sourcePath.absolute)
    const objectVersion = createHash('sha256').update(bytes).digest('hex')
    if (objectVersion !== options.ifMatch) {
      const mismatch = new Error('Object version does not match') as Error & { code?: string }
      mismatch.code = 'OBJECT_VERSION_MISMATCH'
      throw mismatch
    }
    const destination = this.resolvePathForKey(destinationKey)
    await mkdir(dirname(destination.absolute), { recursive: true })
    await writeFile(destination.absolute, bytes)
    return {
      sizeBytes: bytes.byteLength,
      contentType: options.contentType,
      objectVersion,
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const pathInfo = this.resolvePathForKey(input.key)
    await mkdir(dirname(pathInfo.absolute), { recursive: true })
    await writeFile(pathInfo.absolute, input.buffer)
  }

  async getObject(key: string): Promise<Buffer> {
    const pathInfo = this.resolvePathForKey(key)
    return readFile(pathInfo.absolute)
  }

  async deleteObject(key: string): Promise<void> {
    const pathInfo = this.resolvePathForKey(key)
    await rm(pathInfo.absolute, { force: true })
  }

  getPublicUrl(key: string): string {
    return toPublicObjectUrl(this.publicBaseUrl, key)
  }
}
