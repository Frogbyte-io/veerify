import { runSendingDomainPoll } from '~/server/utils/sending-domain-poller'
import { defineScheduledTask } from '../registry'

/** Claims due customer sending domains and advances their status (design §8). */
export const SENDING_DOMAINS_POLL_TASK_NAME = 'support:sending-domains-poll'

export const sendingDomainsPollTask = defineScheduledTask(SENDING_DOMAINS_POLL_TASK_NAME, '*/5 * * * *', () =>
  runSendingDomainPoll()
)
