import { scheduleWeeklyVisibilityRuns } from '~/server/services/marketing/visibility/runner'
import { defineScheduledTask } from '../registry'

export const MARKETING_VISIBILITY_SCHEDULE_TASK_NAME = 'marketing:visibility-schedule'

/** Starts the weekly AI visibility run for each eligible site whose last run is over 7 days old. */
export const marketingVisibilityScheduleTask = defineScheduledTask(
  MARKETING_VISIBILITY_SCHEDULE_TASK_NAME,
  '0 * * * *',
  () => scheduleWeeklyVisibilityRuns()
)
