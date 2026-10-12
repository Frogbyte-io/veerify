import { runMarketingRetention } from '~/server/services/marketing/retention'
import { defineScheduledTask } from '../registry'

/** Daily prune of aged-out Marketing personal data and unbounded tables. */
export const MARKETING_RETENTION_TASK_NAME = 'marketing:retention'

export const marketingRetentionTask = defineScheduledTask(MARKETING_RETENTION_TASK_NAME, '30 3 * * *', () =>
  runMarketingRetention()
)
