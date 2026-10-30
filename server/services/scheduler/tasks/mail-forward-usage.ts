import { runMailForwardUsage } from '~/server/utils/mail-forward-usage'
import { defineScheduledTask } from '../registry'

export const MAIL_FORWARD_USAGE_TASK_NAME = 'mail:forward-usage'

/** Hourly: pause forwarding on workspaces at their monthly forward limit, resume after a new month or tier change. */
export const mailForwardUsageTask = defineScheduledTask(MAIL_FORWARD_USAGE_TASK_NAME, '15 * * * *', () =>
  runMailForwardUsage()
)
