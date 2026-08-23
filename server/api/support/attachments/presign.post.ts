/**
 * @openapi
 * /api/support/attachments/presign:
 *   post:
 *     tags: [Support]
 *     summary: Get an upload target for an agent attachment before sending a reply
 *     description: >
 *       Enforces the per-file type allowlist and size cap
 *       (`server/utils/support-attachments.ts`); the per-message total cap is
 *       enforced where the full attachment list for a message is known, which
 *       is not here. Returns a storage key the client includes when it later
 *       posts the reply - nothing is written to `conversationAttachment` at
 *       this point, since that table's `messageId` is not nullable and no
 *       message exists yet.
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
import {
  ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
  buildOutboundAttachmentStorageKey,
  createAttachmentUploadToken,
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

  const attachmentId = newAttachmentId()
  const storageKey = buildOutboundAttachmentStorageKey(body.conversationId, attachmentId, body.filename)

  const storage = getStorageProvider()

  let uploadTarget: { uploadUrl: string; method: 'PUT'; headers: Record<string, string> }
  let expiresAt: string

  if (storage.driver === 's3') {
    const presigned = await storage.getPresignedUploadTarget(
      storageKey,
      normalizedContentType,
      ATTACHMENT_UPLOAD_EXPIRES_SECONDS
    )
    uploadTarget = presigned
    expiresAt = new Date(Date.now() + ATTACHMENT_UPLOAD_EXPIRES_SECONDS * 1000).toISOString()
  } else {
    // The local driver's generic `getPresignedUploadTarget` points at
    // `/api/uploads/temp/[token]`, which verifies a project-asset-shaped
    // token (`upload-token.ts`). This token has a different shape, so it is
    // routed at our own finalize endpoint instead rather than reusing that
    // URL-building helper.
    const { token, expiresAt: tokenExpiresAt } = createAttachmentUploadToken({
      conversationId: body.conversationId,
      userId: session.user.id,
      storageKey,
      contentType: normalizedContentType,
      sizeBytes: body.sizeBytes,
    })
    uploadTarget = {
      uploadUrl: `/api/support/attachments/upload/${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'content-type': normalizedContentType },
    }
    expiresAt = tokenExpiresAt
  }

  return createSuccessResponse({
    attachmentId,
    storageKey,
    fileName: body.filename,
    contentType: normalizedContentType,
    sizeBytes: body.sizeBytes,
    uploadUrl: uploadTarget.uploadUrl,
    method: uploadTarget.method,
    headers: uploadTarget.headers,
    expiresAt,
  })
})
