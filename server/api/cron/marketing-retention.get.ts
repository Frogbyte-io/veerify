/**
 * @openapi
 * /api/cron/marketing-retention:
 *   get:
 *     tags: [Internal]
 *     summary: Prune aged-out Marketing data
 *     operationId: cronMarketingRetention
 *     responses:
 *       200: { description: Retention prune executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_RETENTION_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-retention'

export default createCronHttpHandler(MARKETING_RETENTION_TASK_NAME)
