/**
 * @openapi
 * /api/cron/marketing-competitors-check:
 *   get:
 *     tags: [Internal]
 *     summary: Check watched competitor pages for changes
 *     operationId: cronMarketingCompetitorsCheck
 *     responses:
 *       200: { description: Competitor check executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_COMPETITORS_CHECK_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-competitors-check'

export default createCronHttpHandler(MARKETING_COMPETITORS_CHECK_TASK_NAME)
