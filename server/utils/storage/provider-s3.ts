import { Readable } from 'node:stream'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StorageProvider, PutObjectInput, PresignedUploadTarget } from './types'

export interface S3StorageProviderOptions {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
  publicBaseUrl?: string
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function buildDefaultPublicUrl(opts: S3StorageProviderOptions, key: string) {
  const normalizedKey = trimSlashes(key)
  if (opts.publicBaseUrl) {
    return `${opts.publicBaseUrl.replace(/\/+$/g, '')}/${normalizedKey}`
  }

  if (opts.endpoint) {
    const endpoint = opts.endpoint.replace(/\/+$/g, '')
    const url = new URL(endpoint)
    if (opts.forcePathStyle) {
      return `${endpoint}/${opts.bucket}/${normalizedKey}`
    }
    return `${url.protocol}//${opts.bucket}.${url.host}/${normalizedKey}`
  }

  return `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${normalizedKey}`
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
      continue
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export class S3StorageProvider implements StorageProvider {
  readonly driver = 's3' as const
  private readonly client: S3Client
  private readonly options: S3StorageProviderOptions

  constructor(options: S3StorageProviderOptions) {
    this.options = options
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint || undefined,
      forcePathStyle: options.forcePathStyle === true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    })
  }

  async getPresignedUploadTarget(
    key: string,
    contentType: string,
    expiresSeconds: number
  ): Promise<PresignedUploadTarget> {
    const normalizedKey = trimSlashes(key)
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: normalizedKey,
      ContentType: contentType,
      CacheControl: 'no-store',
    })
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: expiresSeconds })
    return {
      uploadUrl,
      method: 'PUT',
      headers: {
        'content-type': contentType,
      },
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: trimSlashes(input.key),
        Body: input.buffer,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
      })
    )
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: trimSlashes(key),
      })
    )

    const body = result.Body as any
    if (!body) {
      throw new Error('Object body is empty')
    }

    if (typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray()
      return Buffer.from(bytes)
    }

    if (body instanceof Readable) {
      return streamToBuffer(body)
    }

    throw new Error('Unsupported S3 response body type')
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: trimSlashes(key),
      })
    )
  }

  getPublicUrl(key: string): string {
    return buildDefaultPublicUrl(this.options, key)
  }
}
