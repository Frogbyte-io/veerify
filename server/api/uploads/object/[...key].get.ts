import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'

function getContentTypeFromKey(key: string) {
  const lower = key.toLowerCase()
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

export default defineEventHandler(async (event) => {
  const storage = getStorageProvider()
  if (storage.driver !== 'local') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Object endpoint is only available in local storage mode'),
    })
  }

  const keyParam = getRouterParam(event, 'key')
  if (!keyParam) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Object key is required'),
    })
  }

  const objectKey = keyParam
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')

  try {
    const buffer = await storage.getObject(objectKey)
    setHeader(event, 'content-type', getContentTypeFromKey(objectKey))
    setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
    return buffer
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Asset not found'),
      })
    }
    throw error
  }
})
