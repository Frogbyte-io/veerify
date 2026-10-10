import { advanceAudits } from '~/server/services/marketing/audit/runner'
import { defineScheduledTask } from '../registry'

/** Polls crawl jobs and moves queued/crawling/analyzing audits forward within a time budget. */
export const MARKETING_AUDIT_ADVANCE_TASK_NAME = 'marketing:audit-advance'

export const marketingAuditAdvanceTask = defineScheduledTask(MARKETING_AUDIT_ADVANCE_TASK_NAME, '* * * * *', () =>
  advanceAudits()
)
