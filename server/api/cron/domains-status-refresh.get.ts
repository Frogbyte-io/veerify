/**
 * @openapi
 * /api/cron/domains-status-refresh:
 *   get:
 *     tags: [Internal]
 *     summary: Re-check custom board domains
 *     operationId: cronDomainsStatusRefresh
 *     responses:
 *       200: { description: Domain status refresh pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { DOMAINS_STATUS_REFRESH_TASK_NAME } from '~/server/services/scheduler/tasks/domains-status-refresh'

export default createCronHttpHandler(DOMAINS_STATUS_REFRESH_TASK_NAME)
