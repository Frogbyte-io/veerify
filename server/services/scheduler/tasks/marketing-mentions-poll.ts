import { pollMentions } from '~/server/services/marketing/mentions/poller'
import { defineScheduledTask } from '../registry'

export const MARKETING_MENTIONS_POLL_TASK_NAME = 'marketing:mentions-poll'

export const marketingMentionsPollTask = defineScheduledTask(MARKETING_MENTIONS_POLL_TASK_NAME, '*/15 * * * *', () =>
  pollMentions()
)
