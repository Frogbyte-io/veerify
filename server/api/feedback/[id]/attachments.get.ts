/**
 * @openapi
 * /api/feedback/{id}/attachments:
 *   get:
 *     tags: [Feedback]
 *     summary: List attachments of a feedback item with short-lived signed URLs
 *     description: >
 *       Visible to team members, the author, and public board visitors for
 *       non-hidden, non-support-derived feedback on public products. Hidden
 *       feedback and support-derived items return 404 to everyone else.
 *     operationId: listFeedbackAttachments
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Attachments }
 *       404: { description: Feedback not found or not visible }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { feedbackAttachmentError, FEEDBACK_ATTACHMENT_MAX_COUNT } from '~/server/utils/feedback-attachments'
import {
  listReadyAttachments,
  loadFeedbackAttachmentContext,
  serializeFeedbackAttachment,
} from '~/server/utils/feedback-attachment-access'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) feedbackAttachmentError(400, 'Feedback ID is required')

  const ctx = await loadFeedbackAttachmentContext(event, id)
  if (!ctx.access.canView) feedbackAttachmentError(404, 'Feedback not found')

  const rows = await listReadyAttachments(id)
  const now = new Date()
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return createSuccessResponse({
    attachments: rows.map((row) => serializeFeedbackAttachment(row, ctx.access.canDelete, now)),
    canUpload: ctx.access.canUpload,
    maxCount: FEEDBACK_ATTACHMENT_MAX_COUNT,
  })
})
