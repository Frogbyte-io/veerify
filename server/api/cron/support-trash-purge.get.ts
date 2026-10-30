import { createCronHttpHandler } from '~/server/services/scheduler'
import { TRASH_PURGE_TASK_NAME } from '~/server/services/scheduler/tasks/trash-purge'

/**
 * @openapi
 * /api/cron/support-trash-purge:
 *   get:
 *     tags: [Internal]
 *     summary: Permanently delete inbox conversations that were in Trash for 30 days
 *     operationId: cronSupportTrashPurge
 *     responses:
 *       200: { description: Purge pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
export default createCronHttpHandler(TRASH_PURGE_TASK_NAME)
