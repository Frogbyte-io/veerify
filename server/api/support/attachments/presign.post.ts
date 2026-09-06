/**
 * @openapi
 * /api/support/attachments/presign:
 *   post:
 *     tags: [Support]
 *     summary: Get an upload target for an agent attachment before sending a reply
 *     description: >
 *       Enforces the per-file type allowlist and size cap. Creates a
 *       server-owned pending upload session; clients receive only an opaque
 *       upload id and an upload target, never a storage key.
 *     operationId: presignSupportAttachmentUpload
 *     responses:
 *       200: { description: Upload target }
 *       400: { description: Unsupported type or file too large }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { supportAttachmentUpload } from '~/server/database/schema/support'
import {
  ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
  createSupportUploadTempKey,
  signSupportUploadToken,
  newAttachmentId,
  validateAttachmentUploadInput,
} from '~/server/utils/support-attachments'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  await requireConversationAccess(body.conversationId, session.user.id)

  const normalizedContentType = body.contentType.trim().toLowerCase()
  validateAttachmentUploadInput(normalizedContentType, body.sizeBytes)

  const uploadId = newAttachmentId()
  const expiresAtDate = new Date(Date.now() + ATTACHMENT_UPLOAD_EXPIRES_SECONDS * 1000)
  const tempStorageKey = createSupportUploadTempKey(uploadId, body.filename)
  await db.insert(supportAttachmentUpload).values({
    id: uploadId,
    conversationId: body.conversationId,
    userId: session.user.id,
    tempStorageKey,
    finalStorageKey: null,
    fileName: body.filename,
    requestedContentType: normalizedContentType,
    requestedSizeBytes: body.sizeBytes,
    status: 'pending',
    expiresAt: expiresAtDate,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const storage = getStorageProvider()

  let uploadTarget: { uploadUrl: string; method: 'PUT'; headers: Record<string, string> }
  const expiresAt = expiresAtDate.toISOString()

  if (storage.directUploadConstraints === 'content-length-enforced') {
    const presigned = await storage.getPresignedUploadTarget(
      tempStorageKey,
      normalizedContentType,
      ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
      { expectedSizeBytes: body.sizeBytes }
    )
    uploadTarget = presigned
  } else {
    const token = signSupportUploadToken({ uploadId, expiresAt: expiresAtDate })
    uploadTarget = {
      uploadUrl: `/api/support/attachments/upload/${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'content-type': normalizedContentType },
    }
  }

  return createSuccessResponse({
    uploadId,
    fileName: body.filename,
    contentType: normalizedContentType,
    uploadUrl: uploadTarget.uploadUrl,
    method: uploadTarget.method,
    headers: uploadTarget.headers,
    expiresAt,
  })
})
