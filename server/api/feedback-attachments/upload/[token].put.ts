/**
 * @openapi
 * /api/feedback-attachments/upload/{token}:
 *   put:
 *     tags: [Feedback]
 *     summary: Stream bytes into a pending feedback attachment
 *     description: >
 *       Used when storage does not enforce content length on direct uploads
 *       (local driver, or S3 with proxy-required). The token only identifies a
 *       pending attachment; the 10 MB limit is enforced while reading the stream
 *       and the storage key is never caller-supplied.
 *     operationId: uploadFeedbackAttachment
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Uploaded }
 *       400: { description: Invalid token, type mismatch, or size mismatch }
 *       404: { description: Attachment not found }
 *       409: { description: Attachment already finalized }
 *       413: { description: Upload exceeds the 10 MB limit }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import {
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  feedbackAttachmentError,
  verifyFeedbackAttachmentUploadToken,
} from '~/server/utils/feedback-attachments'

async function readBoundedBody(event: Parameters<typeof getHeader>[0]): Promise<Buffer> {
  const request = event?.node?.req
  if (!request || typeof request[Symbol.asyncIterator] !== 'function') {
    feedbackAttachmentError(400, 'Upload body is required')
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (contentLength > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    feedbackAttachmentError(413, 'Attachment exceeds the 10 MB limit')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const value of request as AsyncIterable<Buffer | Uint8Array | string>) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    total += chunk.byteLength
    if (total > FEEDBACK_ATTACHMENT_MAX_BYTES) {
      if (typeof request.pause === 'function') request.pause()
      feedbackAttachmentError(413, 'Attachment exceeds the 10 MB limit')
    }
    chunks.push(chunk)
  }
  if (total === 0) feedbackAttachmentError(400, 'Upload body is required')
  return Buffer.concat(chunks, total)
}

export default defineEventHandler(async (event) => {
  const tokenParam = getRouterParam(event, 'token')
  if (!tokenParam) feedbackAttachmentError(400, 'Upload token is required')
  const token = verifyFeedbackAttachmentUploadToken(decodeURIComponent(tokenParam))

  const [row] = await db.select().from(feedbackAttachment).where(eq(feedbackAttachment.id, token.attachmentId)).limit(1)
  if (!row) feedbackAttachmentError(404, 'Attachment not found')
  if (row.status !== 'pending') feedbackAttachmentError(409, 'Attachment has already been finalized')

  const contentType = String(getHeader(event, 'content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType !== row.requestedContentType) {
    feedbackAttachmentError(400, 'Upload content type does not match the requested type')
  }

  const buffer = await readBoundedBody(event)
  if (buffer.byteLength !== row.requestedSizeBytes) {
    feedbackAttachmentError(400, 'Uploaded size does not match the requested size')
  }

  await getStorageProvider().putObject({
    key: row.storageKey,
    buffer,
    contentType: row.requestedContentType,
    cacheControl: 'private, no-store',
  })

  return createSuccessResponse({ uploaded: true, attachmentId: row.id, sizeBytes: buffer.byteLength })
})
