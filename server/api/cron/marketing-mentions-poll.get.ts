/**
 * @openapi
 * /api/cron/marketing-mentions-poll:
 *   get:
 *     tags: [Internal]
 *     summary: Poll social sources for marketing mentions
 *     operationId: cronMarketingMentionsPoll
 *     responses:
 *       200: { description: Mentions poll executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_MENTIONS_POLL_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-mentions-poll'

export default createCronHttpHandler(MARKETING_MENTIONS_POLL_TASK_NAME)
