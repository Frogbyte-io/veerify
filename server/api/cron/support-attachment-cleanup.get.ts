import { createCronHttpHandler } from '~/server/services/scheduler'
import { ATTACHMENT_CLEANUP_TASK_NAME } from '~/server/services/scheduler/tasks/attachment-cleanup'

/**
 * @openapi
 * /api/cron/support-attachment-cleanup:
 *   get:
 *     tags: [Internal]
 *     summary: Recover abandoned support attachment uploads
 *     operationId: cronSupportAttachmentCleanup
 *     responses:
 *       200: { description: Cleanup pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
export default createCronHttpHandler(ATTACHMENT_CLEANUP_TASK_NAME)
