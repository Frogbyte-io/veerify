import { createCronHttpHandler } from '~/server/services/scheduler'
import { MAIL_FORWARD_USAGE_TASK_NAME } from '~/server/services/scheduler/tasks/mail-forward-usage'

/**
 * @openapi
 * /api/cron/mail-forward-usage:
 *   get:
 *     tags: [Internal]
 *     summary: Pause email forwarding at the monthly limit, resume after a new month
 *     operationId: cronMailForwardUsage
 *     responses:
 *       200: { description: Usage pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
export default createCronHttpHandler(MAIL_FORWARD_USAGE_TASK_NAME)
