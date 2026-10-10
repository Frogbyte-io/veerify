/**
 * @openapi
 * /api/cron/marketing-search-sync:
 *   get:
 *     tags: [Internal]
 *     summary: Sync Google Search Console data for marketing sites
 *     operationId: cronMarketingSearchSync
 *     responses:
 *       200: { description: Search Console sync executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_SEARCH_SYNC_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-search-sync'

export default createCronHttpHandler(MARKETING_SEARCH_SYNC_TASK_NAME)
