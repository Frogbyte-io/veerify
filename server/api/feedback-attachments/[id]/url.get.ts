/**
 * @openapi
 * /api/feedback-attachments/{id}/url:
 *   get:
 *     tags: [Feedback]
 *     summary: Get a fresh short-lived signed download URL for an attachment
 *     description: >
 *       Issued only to viewers allowed to see the feedback: team members, the
 *       author, and public board visitors for non-hidden, non-support-derived
 *       feedback on public products.
 *     operationId: getFeedbackAttachmentUrl
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Signed URL }
 *       404: { description: Attachment not found or not visible }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import { feedbackAttachmentError } from '~/server/utils/feedback-attachments'
import { loadFeedbackAttachmentContext, serializeFeedbackAttachment } from '~/server/utils/feedback-attachment-access'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) feedbackAttachmentError(400, 'Attachment id is required')

  const [row] = await db.select().from(feedbackAttachment).where(eq(feedbackAttachment.id, id)).limit(1)
  if (!row || row.status !== 'ready' || !row.feedbackId) feedbackAttachmentError(404, 'Attachment not found')

  const ctx = await loadFeedbackAttachmentContext(event, row.feedbackId)
  if (!ctx.access.canView) feedbackAttachmentError(404, 'Attachment not found')

  setResponseHeader(event, 'cache-control', 'private, no-store')
  return createSuccessResponse(serializeFeedbackAttachment(row, ctx.access.canDelete))
})
