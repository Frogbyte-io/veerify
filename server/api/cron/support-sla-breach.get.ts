/**
 * @openapi
 * /api/cron/support-sla-breach:
 *   get:
 *     tags: [Internal]
 *     summary: Stamp overdue SLA metrics and dispatch escalation notifications
 *     operationId: cronSupportSlaBreach
 *     responses:
 *       200: { description: SLA breach pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { SLA_BREACH_TASK_NAME } from '~/server/services/scheduler/tasks/sla-breach'

export default createCronHttpHandler(SLA_BREACH_TASK_NAME)
