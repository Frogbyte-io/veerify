import { refreshCustomDomainStatuses } from '~/server/services/domains/status-refresh'
import { defineScheduledTask } from '../registry'

/** Re-checks custom board domains against Cloudflare for SaaS (read-only). */
export const DOMAINS_STATUS_REFRESH_TASK_NAME = 'domains:status-refresh'

export const domainsStatusRefreshTask = defineScheduledTask(DOMAINS_STATUS_REFRESH_TASK_NAME, '*/10 * * * *', () =>
  refreshCustomDomainStatuses()
)
