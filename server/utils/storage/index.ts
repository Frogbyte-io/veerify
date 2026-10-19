import { createErrorResponse, ErrorCode } from '../response'
import type { StorageProvider, StorageDriver } from './types'
import { S3StorageProvider } from './provider-s3'
import { LocalStorageProvider } from './provider-local'

function validateS3Config(config: ReturnType<typeof useRuntimeConfig>) {
  const missing: string[] = []
  if (!config.storageBucket) missing.push('STORAGE_BUCKET')
  if (!config.storageAccessKeyId) missing.push('STORAGE_ACCESS_KEY_ID')
  if (!config.storageSecretAccessKey) missing.push('STORAGE_SECRET_ACCESS_KEY')
  if (missing.length > 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Storage not configured',
      data: createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        `S3 storage is missing required configuration: ${missing.join(', ')}`
      ),
    })
  }
}

export function getStorageDriver(): StorageDriver {
  const config = useRuntimeConfig()
  const driver = String(config.storageDriver || 'local').toLowerCase()
  return driver === 's3' ? 's3' : 'local'
}

export function getStorageProvider(): StorageProvider {
  const config = useRuntimeConfig()
  const driver = getStorageDriver()

  if (driver === 's3') {
    validateS3Config(config)
    return new S3StorageProvider({
      bucket: config.storageBucket,
      region: config.storageRegion || 'auto',
      endpoint: config.storageEndpoint || undefined,
      accessKeyId: config.storageAccessKeyId,
      secretAccessKey: config.storageSecretAccessKey,
      forcePathStyle: config.storageForcePathStyle === true,
      publicBaseUrl: config.storagePublicBaseUrl || undefined,
      directUploadConstraints:
        config.storageDirectUploadConstraints === 'content-length-enforced'
          ? 'content-length-enforced'
          : 'proxy-required',
    })
  }

  return new LocalStorageProvider({
    rootDir: config.storageLocalDir || '.data/storage',
    publicBaseUrl: config.storagePublicBaseUrl || undefined,
  })
}
