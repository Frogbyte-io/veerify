/**
 * @openapi
 * /api/support/attachments/upload/{token}:
 *   put:
 *     tags: [Support]
 *     summary: Write agent-attachment bytes to local storage (local driver only)
 *     description: >
 *       Counterpart to `/api/support/attachments/presign` when `STORAGE_DRIVER`
 *       is `local` - there is no real presigned URL without S3, so the signed
 *       token itself is the authorization to write to the storage key it
 *       names. Writes directly to the final key; unlike the project-asset
 *       upload flow there is no temp-then-move step, since the final key is
 *       already known at presign time.
 *     operationId: uploadSupportAttachment
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Uploaded }
 *       400: { description: Invalid token, content-type mismatch, or missing body }
 *       404: { description: Not available outside local storage mode }
 */
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { validateAttachmentUploadInput, verifyAttachmentUploadToken } from '~/server/utils/support-attachments'

export default defineEventHandler(async (event) => {
  const storage = getStorageProvider()
  if (storage.driver !== 'local') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'This upload endpoint is only available in local storage mode'),
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

  const payload = verifyAttachmentUploadToken(decodeURIComponent(tokenParam))

  const contentTypeHeader = String(getHeader(event, 'content-type') || '')
  const normalizedContentType = contentTypeHeader.split(';')[0].trim().toLowerCase()
  if (!normalizedContentType || normalizedContentType !== payload.contentType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Upload content type does not match the presigned type'),
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
  // Re-checked against the actual bytes, not just the declared sizeBytes the
  // presign request carried - a caller could presign small and upload large.
  validateAttachmentUploadInput(normalizedContentType, bodyBuffer.byteLength)

  await storage.putObject({
    key: payload.storageKey,
    buffer: bodyBuffer,
    contentType: normalizedContentType,
  })

  return createSuccessResponse({ uploaded: true, storageKey: payload.storageKey })
})
