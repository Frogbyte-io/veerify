import { scheduleAudits } from '~/server/services/marketing/audit/runner'
import { recheckVerifiedSites } from '~/server/services/marketing/site-recheck'
import { defineScheduledTask } from '../registry'

/**
 * Re-checks site verification (domain coverage hourly, token methods monthly),
 * then queues the first audit after verification and weekly audits for verified sites.
 */
export const MARKETING_AUDIT_SCHEDULE_TASK_NAME = 'marketing:audit-schedule'

export const marketingAuditScheduleTask = defineScheduledTask(
  MARKETING_AUDIT_SCHEDULE_TASK_NAME,
  '5 * * * *',
  async () => {
    try {
      await recheckVerifiedSites()
    } catch {
      // A failed re-check must never block audit scheduling
    }
    return scheduleAudits()
  }
)
