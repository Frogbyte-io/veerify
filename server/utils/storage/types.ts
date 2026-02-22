export type StorageDriver = 's3' | 'local'

export interface PresignedUploadTarget {
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

export interface PutObjectInput {
  key: string
  buffer: Buffer
  contentType: string
  cacheControl?: string
}

export interface StorageProvider {
  driver: StorageDriver
  getPresignedUploadTarget(keyOrToken: string, contentType: string, expiresSeconds: number): Promise<PresignedUploadTarget>
  putObject(input: PutObjectInput): Promise<void>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
  getPublicUrl(key: string): string
}
