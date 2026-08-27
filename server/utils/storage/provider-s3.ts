import { Readable } from 'node:stream'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  StorageProvider,
  PutObjectInput,
  PresignedUploadTarget,
  StorageObjectMetadata,
  CopyObjectOptions,
  DirectUploadConstraints,
  PresignedUploadOptions,
} from './types'

export interface S3StorageProviderOptions {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
  publicBaseUrl?: string
  directUploadConstraints?: DirectUploadConstraints
  client?: S3Client
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeEtag(etag: string | undefined) {
  return etag?.replace(/^"|"$/g, '') || null
}

function encodeCopySource(bucket: string, key: string) {
  return `${bucket}/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
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
  readonly directUploadConstraints: DirectUploadConstraints
  private readonly client: S3Client
  private readonly options: S3StorageProviderOptions

  constructor(options: S3StorageProviderOptions) {
    this.options = options
    this.client = options.client || new S3Client({
      region: options.region,
      endpoint: options.endpoint || undefined,
      forcePathStyle: options.forcePathStyle === true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    })
    this.directUploadConstraints = options.directUploadConstraints === 'content-length-enforced'
      ? 'content-length-enforced'
      : 'proxy-required'
  }

  async getPresignedUploadTarget(
    key: string,
    contentType: string,
    expiresSeconds: number,
    options: PresignedUploadOptions = {}
  ): Promise<PresignedUploadTarget> {
    if (
      this.directUploadConstraints === 'content-length-enforced'
      && (!Number.isSafeInteger(options.expectedSizeBytes) || options.expectedSizeBytes! <= 0)
    ) {
      throw new Error('A positive expected object size is required for constrained direct uploads')
    }
    const normalizedKey = trimSlashes(key)
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: normalizedKey,
      ContentType: contentType,
      CacheControl: 'no-store',
      ...(this.directUploadConstraints === 'content-length-enforced' && options.expectedSizeBytes !== undefined
        ? { ContentLength: options.expectedSizeBytes }
        : {}),
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

  async headObject(key: string): Promise<StorageObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: trimSlashes(key),
      })
    )
    const objectVersion = result.VersionId || normalizeEtag(result.ETag)
    if (!objectVersion || result.ContentLength === undefined) {
      const invalid = new Error('Storage object metadata is incomplete') as Error & { code?: string }
      invalid.code = 'OBJECT_METADATA_INVALID'
      throw invalid
    }
    return {
      sizeBytes: Number(result.ContentLength),
      contentType: result.ContentType || null,
      objectVersion,
    }
  }

  async copyObject(sourceKey: string, destinationKey: string, options: CopyObjectOptions): Promise<StorageObjectMetadata> {
    const source = trimSlashes(sourceKey)
    const destination = trimSlashes(destinationKey)
    try {
      const sourceHead = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: source })
      )
      const sourceObjectVersion = sourceHead.VersionId || normalizeEtag(sourceHead.ETag)
      if (!sourceObjectVersion || sourceObjectVersion !== options.ifMatch) {
        const mismatch = new Error('Object version does not match') as Error & { code?: string }
        mismatch.code = 'OBJECT_VERSION_MISMATCH'
        throw mismatch
      }
      const isVersionId = Boolean(sourceHead.VersionId)
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucket,
          CopySource: isVersionId
            ? `${encodeCopySource(this.options.bucket, source)}?versionId=${encodeURIComponent(options.ifMatch)}`
            : encodeCopySource(this.options.bucket, source),
          Key: destination,
          ContentType: options.contentType,
          MetadataDirective: 'REPLACE',
          ...(isVersionId ? {} : { CopySourceIfMatch: options.ifMatch }),
        })
      )
      // CopyObject does not report a trustworthy byte length, and version IDs
      // belong to the output object rather than CopyObjectResult. Read the
      // destination after the copy so callers receive one coherent snapshot.
      return await this.headObject(destination)
    } catch (error: unknown) {
      const cause = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
      if (cause.code === 'OBJECT_VERSION_MISMATCH' || cause.name === 'PreconditionFailed' || cause.$metadata?.httpStatusCode === 412) {
        const mismatch = new Error('Object version does not match') as Error & { code?: string }
        mismatch.code = 'OBJECT_VERSION_MISMATCH'
        throw mismatch
      }
      throw error
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
