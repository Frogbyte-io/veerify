import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_VISIBILITY_ADVANCE_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-visibility-advance'

export default createCronHttpHandler(MARKETING_VISIBILITY_ADVANCE_TASK_NAME)
