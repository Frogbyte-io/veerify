import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_VISIBILITY_SCHEDULE_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-visibility-schedule'

export default createCronHttpHandler(MARKETING_VISIBILITY_SCHEDULE_TASK_NAME)
