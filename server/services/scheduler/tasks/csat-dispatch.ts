import { runCsatDispatchSweep } from '~/server/utils/csat'
import { defineScheduledTask } from '../registry'

export const CSAT_DISPATCH_TASK_NAME = 'support:csat-dispatch'

export const csatDispatchTask = defineScheduledTask(CSAT_DISPATCH_TASK_NAME, '*/5 * * * *', () =>
  runCsatDispatchSweep()
)
