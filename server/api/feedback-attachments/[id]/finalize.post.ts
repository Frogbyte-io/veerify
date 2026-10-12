/**
 * @openapi
 * /api/feedback-attachments/{id}/finalize:
 *   post:
 *     tags: [Feedback]
 *     summary: Validate an uploaded feedback attachment and mark it ready
 *     description: >
 *       Re-checks the stored object server-side: size, content sniffing against
 *       the allowlist (images, PDF, .txt/.log/.json), and decodes and re-encodes
 *       JPEG/PNG/WebP images to strip EXIF metadata. Invalid uploads are deleted.
 *     operationId: finalizeFeedbackAttachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Attachment ready }
 *       400: { description: Content rejected }
 *       404: { description: Attachment or uploaded object not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import {
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  feedbackAttachmentError,
  isMissingStorageObject,
  processFeedbackAttachment,
} from '~/server/utils/feedback-attachments'
import {
  countFeedbackAttachmentSlots,
  isRowUploader,
  resolveAttachmentActor,
  serializeFeedbackAttachment,
} from '~/server/utils/feedback-attachment-access'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) feedbackAttachmentError(400, 'Attachment id is required')

  const actor = await resolveAttachmentActor(event)
  const [row] = await db.select().from(feedbackAttachment).where(eq(feedbackAttachment.id, id)).limit(1)
  // A foreign row is indistinguishable from a missing one.
  if (!row || !isRowUploader(row, actor)) feedbackAttachmentError(404, 'Attachment not found')
  if (row.status === 'ready') return createSuccessResponse(serializeFeedbackAttachment(row, true))

  const storage = getStorageProvider()
  const discard = async () => {
    await storage.deleteObject(row.storageKey).catch(() => undefined)
    await db.delete(feedbackAttachment).where(eq(feedbackAttachment.id, row.id))
  }

  let buffer: Buffer
  try {
    const metadata = await storage.headObject(row.storageKey)
    if (metadata.sizeBytes > FEEDBACK_ATTACHMENT_MAX_BYTES || metadata.sizeBytes !== row.requestedSizeBytes) {
      await discard()
      feedbackAttachmentError(400, 'Uploaded size does not match the requested size')
    }
    buffer = await storage.getObject(row.storageKey)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    if (isMissingStorageObject(error)) feedbackAttachmentError(404, 'Uploaded object not found')
    throw error
  }

  let processed
  try {
    processed = await processFeedbackAttachment(buffer, row.fileName, row.requestedContentType)
    if (
      row.feedbackId &&
      (await countFeedbackAttachmentSlots(row.feedbackId, row.id)) >= FEEDBACK_ATTACHMENT_MAX_COUNT
    ) {
      feedbackAttachmentError(400, `At most ${FEEDBACK_ATTACHMENT_MAX_COUNT} attachments are allowed per feedback`)
    }
  } catch (error) {
    await discard()
    throw error
  }

  if (processed.rewritten) {
    await storage.putObject({
      key: row.storageKey,
      buffer: processed.buffer,
      contentType: processed.contentType,
      cacheControl: 'private, no-store',
    })
  }

  const [updated] = await db
    .update(feedbackAttachment)
    .set({
      status: 'ready',
      contentType: processed.contentType,
      sizeBytes: processed.buffer.byteLength,
      kind: processed.kind,
      width: processed.width,
      height: processed.height,
      attachedAt: row.feedbackId ? new Date() : null,
    })
    .where(eq(feedbackAttachment.id, row.id))
    .returning()

  return createSuccessResponse(serializeFeedbackAttachment(updated, true))
})
