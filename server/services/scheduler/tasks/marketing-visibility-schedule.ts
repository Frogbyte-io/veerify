import { resetStaleReservations } from '~/server/services/marketing/llm-budget'
import { scheduleWeeklyVisibilityRuns } from '~/server/services/marketing/visibility/runner'
import { defineScheduledTask } from '../registry'

export const MARKETING_VISIBILITY_SCHEDULE_TASK_NAME = 'marketing:visibility-schedule'

/**
 * Starts the weekly AI visibility run for each eligible site whose last run is over 7 days old.
 * Also clears LLM budget reservations leaked by crashed calls (untouched for 15 minutes).
 */
export const marketingVisibilityScheduleTask = defineScheduledTask(
  MARKETING_VISIBILITY_SCHEDULE_TASK_NAME,
  '0 * * * *',
  async () => {
    // Housekeeping must never block scheduling
    await resetStaleReservations().catch(() => undefined)
    return scheduleWeeklyVisibilityRuns()
  }
)
