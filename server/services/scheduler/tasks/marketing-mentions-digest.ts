import { sendMentionsDigests } from '~/server/services/marketing/mentions/digest'
import { defineScheduledTask } from '../registry'

export const MARKETING_MENTIONS_DIGEST_TASK_NAME = 'marketing:mentions-digest'

export const marketingMentionsDigestTask = defineScheduledTask(MARKETING_MENTIONS_DIGEST_TASK_NAME, '0 8 * * *', () =>
  sendMentionsDigests()
)
