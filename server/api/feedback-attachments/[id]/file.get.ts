/**
 * @openapi
 * /api/feedback-attachments/{id}/file:
 *   get:
 *     tags: [Feedback]
 *     summary: Download an attachment through a signed, expiring URL
 *     description: >
 *       The URL is minted by the list/url endpoints after an authorization
 *       check and is scoped to this attachment id with a 5 minute expiry. Images
 *       render inline; everything else is a forced download. Responses are sandboxed
 *       with `nosniff` and a restrictive CSP.
 *     operationId: downloadFeedbackAttachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: exp
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: sig
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: File bytes }
 *       403: { description: Invalid or expired signature }
 *       404: { description: Attachment not found }
 */
import { eq } from 'drizzle-orm'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import {
  FEEDBACK_ATTACHMENT_DOWNLOAD_EXPIRES_SECONDS,
  feedbackAttachmentError,
  isMissingStorageObject,
  verifyFeedbackAttachmentDownloadSignature,
} from '~/server/utils/feedback-attachments'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) feedbackAttachmentError(400, 'Attachment id is required')

  const query = getQuery(event)
  if (!verifyFeedbackAttachmentDownloadSignature(id, query.exp, query.sig)) {
    feedbackAttachmentError(403, 'This download link is invalid or has expired')
  }

  const [row] = await db.select().from(feedbackAttachment).where(eq(feedbackAttachment.id, id)).limit(1)
  // Deleted feedback leaves the row detached; its bytes must stop being served immediately.
  if (!row || row.status !== 'ready' || !row.feedbackId) feedbackAttachmentError(404, 'Attachment not found')

  let buffer: Buffer
  try {
    buffer = await getStorageProvider().getObject(row.storageKey)
  } catch (error) {
    if (isMissingStorageObject(error)) feedbackAttachmentError(404, 'Attachment not found')
    throw error
  }

  const isImage = row.kind === 'image'
  const safeName = row.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  setResponseHeaders(event, {
    'content-type': row.contentType,
    'content-length': buffer.byteLength,
    'content-disposition': `${isImage ? 'inline' : 'attachment'}; filename="${safeName}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': `private, max-age=${Math.floor(FEEDBACK_ATTACHMENT_DOWNLOAD_EXPIRES_SECONDS / 2)}`,
  })
  return buffer
})
