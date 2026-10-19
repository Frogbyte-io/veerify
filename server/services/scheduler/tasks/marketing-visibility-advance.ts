import { advanceVisibilityRuns } from '~/server/services/marketing/visibility/runner'
import { defineScheduledTask } from '../registry'

export const MARKETING_VISIBILITY_ADVANCE_TASK_NAME = 'marketing:visibility-advance'

/** Claims pending AI visibility answers and works through them within a time budget. */
export const marketingVisibilityAdvanceTask = defineScheduledTask(
  MARKETING_VISIBILITY_ADVANCE_TASK_NAME,
  '* * * * *',
  () => advanceVisibilityRuns()
)
