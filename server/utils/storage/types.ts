export type StorageDriver = 's3' | 'local'

export interface PresignedUploadTarget {
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

export interface StorageObjectMetadata {
  sizeBytes: number
  contentType: string | null
  objectVersion: string
}

export interface CopyObjectOptions {
  contentType: string
  ifMatch: string
}

export type DirectUploadConstraints = 'content-length-enforced' | 'proxy-required'

export interface PresignedUploadOptions {
  expectedSizeBytes?: number
}

export interface PutObjectInput {
  key: string
  buffer: Buffer
  contentType: string
  cacheControl?: string
}

export interface StorageProvider {
  driver: StorageDriver
  readonly directUploadConstraints: DirectUploadConstraints
  getPresignedUploadTarget(
    keyOrToken: string,
    contentType: string,
    expiresSeconds: number,
    options?: PresignedUploadOptions
  ): Promise<PresignedUploadTarget>
  putObject(input: PutObjectInput): Promise<void>
  headObject(key: string): Promise<StorageObjectMetadata>
  copyObject(sourceKey: string, destinationKey: string, options: CopyObjectOptions): Promise<StorageObjectMetadata>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
  getPublicUrl(key: string): string
}
