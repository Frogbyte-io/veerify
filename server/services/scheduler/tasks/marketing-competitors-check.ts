import { checkCompetitorWatches } from '~/server/services/marketing/competitors/checker'
import { defineScheduledTask } from '../registry'

/** Checks due competitor pages (each at most daily) every 10 minutes, within a 45 second budget. */
export const MARKETING_COMPETITORS_CHECK_TASK_NAME = 'marketing:competitors-check'

export const marketingCompetitorsCheckTask = defineScheduledTask(
  MARKETING_COMPETITORS_CHECK_TASK_NAME,
  '*/10 * * * *',
  () => checkCompetitorWatches()
)
