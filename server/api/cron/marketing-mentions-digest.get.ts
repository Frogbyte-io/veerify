/**
 * @openapi
 * /api/cron/marketing-mentions-digest:
 *   get:
 *     tags: [Internal]
 *     summary: Email the daily marketing mentions digest
 *     operationId: cronMarketingMentionsDigest
 *     responses:
 *       200: { description: Mentions digest executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_MENTIONS_DIGEST_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-mentions-digest'

export default createCronHttpHandler(MARKETING_MENTIONS_DIGEST_TASK_NAME)
