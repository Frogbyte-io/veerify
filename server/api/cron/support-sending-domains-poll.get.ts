/**
 * @openapi
 * /api/cron/support-sending-domains-poll:
 *   get:
 *     tags: [Internal]
 *     summary: Poll customer sending domains
 *     operationId: cronSupportSendingDomainsPoll
 *     responses:
 *       200: { description: Sending-domain poll pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { SENDING_DOMAINS_POLL_TASK_NAME } from '~/server/services/scheduler/tasks/sending-domains-poll'

export default createCronHttpHandler(SENDING_DOMAINS_POLL_TASK_NAME)
