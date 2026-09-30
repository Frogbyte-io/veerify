/**
 * @openapi
 * /api/cron/support-automation-rules:
 *   get:
 *     tags: [Internal]
 *     summary: Evaluate time-based support automation rules
 *     operationId: cronSupportAutomationRules
 *     responses:
 *       200: { description: Time-based automation pass executed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { AUTOMATION_RULES_TASK_NAME } from '~/server/services/scheduler/tasks/automation-rules'

export default createCronHttpHandler(AUTOMATION_RULES_TASK_NAME)
