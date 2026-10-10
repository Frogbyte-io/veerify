import { scheduleAudits } from '~/server/services/marketing/audit/runner'
import { defineScheduledTask } from '../registry'

/** Queues the first audit after verification and weekly audits for verified sites. */
export const MARKETING_AUDIT_SCHEDULE_TASK_NAME = 'marketing:audit-schedule'

export const marketingAuditScheduleTask = defineScheduledTask(MARKETING_AUDIT_SCHEDULE_TASK_NAME, '5 * * * *', () =>
  scheduleAudits()
)
