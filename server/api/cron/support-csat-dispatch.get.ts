/**
 * @openapi
 * /api/cron/support-csat-dispatch:
 *   get:
 *     tags: [Internal]
 *     summary: Dispatch due CSAT surveys
 *     operationId: cronSupportCsatDispatch
 *     responses:
 *       200: { description: CSAT dispatch pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { CSAT_DISPATCH_TASK_NAME } from '~/server/services/scheduler/tasks/csat-dispatch'

export default createCronHttpHandler(CSAT_DISPATCH_TASK_NAME)
