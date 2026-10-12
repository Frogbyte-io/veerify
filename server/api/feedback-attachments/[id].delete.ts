/**
 * @openapi
 * /api/feedback-attachments/{id}:
 *   delete:
 *     tags: [Feedback]
 *     summary: Delete a feedback attachment
 *     description: Allowed for the feedback author or a team member of the project. Pending uploads may be deleted by their uploader.
 *     operationId: deleteFeedbackAttachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Not allowed }
 *       404: { description: Attachment not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import { feedbackAttachmentError, isMissingStorageObject } from '~/server/utils/feedback-attachments'
import {
  isRowUploader,
  loadFeedbackAttachmentContext,
  resolveAttachmentActor,
} from '~/server/utils/feedback-attachment-access'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) feedbackAttachmentError(400, 'Attachment id is required')

  const [row] = await db.select().from(feedbackAttachment).where(eq(feedbackAttachment.id, id)).limit(1)
  if (!row) feedbackAttachmentError(404, 'Attachment not found')

  if (row.feedbackId) {
    const ctx = await loadFeedbackAttachmentContext(event, row.feedbackId)
    if (!ctx.access.canView) feedbackAttachmentError(404, 'Attachment not found')
    if (!ctx.access.canDelete) feedbackAttachmentError(403, 'You cannot remove this attachment')
  } else {
    // Not yet attached to feedback: only the uploader may discard it.
    const actor = await resolveAttachmentActor(event)
    if (!isRowUploader(row, actor)) feedbackAttachmentError(404, 'Attachment not found')
  }

  try {
    await getStorageProvider().deleteObject(row.storageKey)
  } catch (error) {
    if (!isMissingStorageObject(error)) throw error
  }
  await db.delete(feedbackAttachment).where(eq(feedbackAttachment.id, row.id))

  return createSuccessResponse({ id: row.id, deleted: true })
})
