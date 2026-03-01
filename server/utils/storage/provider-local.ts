import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StorageProvider, PutObjectInput, PresignedUploadTarget } from './types'

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
