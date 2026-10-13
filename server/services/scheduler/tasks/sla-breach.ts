import { runSlaBreachSweep } from '~/server/utils/sla-sweeper'
import { defineScheduledTask } from '../registry'

export const SLA_BREACH_TASK_NAME = 'support:sla-breach'

export const slaBreachTask = defineScheduledTask(SLA_BREACH_TASK_NAME, '*/5 * * * *', () => runSlaBreachSweep())
