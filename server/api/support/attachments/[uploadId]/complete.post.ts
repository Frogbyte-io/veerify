/**
 * @openapi
 * /api/support/attachments/{uploadId}/complete:
 *   post:
 *     tags: [Support]
 *     summary: Complete and verify a direct attachment upload
 *     description: Re-checks ownership, conversation access, expiry, object size, content type, and object version before marking the session uploaded.
 *     operationId: completeSupportAttachmentUpload
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Upload completed }
 *       400: { description: Object metadata does not match the session }
 *       401: { description: Authentication required }
 *       403: { description: No conversation access }
 *       404: { description: Upload session or object not found }
 *       409: { description: Object changed or upload state is unavailable }
 */
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { supportAttachmentUpload } from '~/server/database/schema/support'

function completionError(statusCode: number, message: string, code: string = ErrorCode.VALIDATION_ERROR): never {
  throw createError({ statusCode, statusMessage: statusCode === 404 ? 'Not Found' : 'Validation failed', data: createErrorResponse(code, message) })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const uploadId = getRouterParam(event, 'uploadId')
  if (!uploadId) completionError(400, 'Upload id is required')

  return await db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(supportAttachmentUpload)
      .where(eq(supportAttachmentUpload.id, uploadId))
      .for('update')
      .limit(1)
    if (!upload || upload.userId !== session.user.id) completionError(404, 'Upload session not found')

    await requireConversationAccess(upload.conversationId, session.user.id)
    if (upload.expiresAt.getTime() <= Date.now()) completionError(400, 'Upload session has expired')
    if (upload.status !== 'pending' && upload.status !== 'uploaded') completionError(409, 'Upload session is not available')

    const storage = getStorageProvider()
    if (storage.directUploadConstraints !== 'content-length-enforced') {
      completionError(409, 'This upload session must be completed through the proxy', ErrorCode.CONFLICT)
    }
    let metadata
    try {
      metadata = await storage.headObject(upload.tempStorageKey)
    } catch (error: unknown) {
      const cause = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
      if (cause.code === 'OBJECT_NOT_FOUND' || cause.$metadata?.httpStatusCode === 404 || cause.name === 'NotFound') {
        completionError(404, 'Uploaded object not found')
      }
      throw error
    }
    if (metadata.sizeBytes !== upload.requestedSizeBytes) completionError(400, 'Uploaded size does not match the presigned size')
    if (metadata.contentType !== upload.requestedContentType) completionError(400, 'Uploaded content type does not match the presigned type')
    if (upload.status === 'uploaded' && upload.objectVersion && upload.objectVersion !== metadata.objectVersion) {
      completionError(409, 'Uploaded object has changed', ErrorCode.CONFLICT)
    }

    await tx
      .update(supportAttachmentUpload)
      .set({
        storedContentType: metadata.contentType,
        actualSizeBytes: metadata.sizeBytes,
        objectVersion: metadata.objectVersion,
        uploadedAt: upload.uploadedAt || new Date(),
        status: 'uploaded',
        updatedAt: new Date(),
      })
      .where(eq(supportAttachmentUpload.id, upload.id))

    return createSuccessResponse({
      uploaded: true,
      uploadId: upload.id,
      fileName: upload.fileName,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      objectVersion: metadata.objectVersion,
    })
  })
})
