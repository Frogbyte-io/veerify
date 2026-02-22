import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { validateImageUploadInput } from '~/server/utils/storage/media'
import { verifyUploadToken } from '~/server/utils/upload-token'

export default defineEventHandler(async (event) => {
  const storage = getStorageProvider()
  if (storage.driver !== 'local') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Temporary upload endpoint is only available in local storage mode'),
    })
  }

  const tokenParam = getRouterParam(event, 'token')
  if (!tokenParam) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Upload token is required'),
    })
  }

  const uploadToken = decodeURIComponent(tokenParam)
  const payload = verifyUploadToken(uploadToken)

  const contentTypeHeader = String(getHeader(event, 'content-type') || '')
  const normalizedContentType = contentTypeHeader.split(';')[0].trim().toLowerCase()
  if (!normalizedContentType || normalizedContentType !== payload.contentType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Upload content type does not match requested type'),
    })
  }

  const rawBody = await readRawBody(event, false)
  if (!rawBody) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Upload body is required'),
    })
  }

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)
  validateImageUploadInput(payload.kind, normalizedContentType, bodyBuffer.byteLength)

  await storage.putObject({
    key: payload.tempKey,
    buffer: bodyBuffer,
    contentType: normalizedContentType,
    cacheControl: 'no-store',
  })

  return createSuccessResponse({
    uploaded: true,
  })
})
