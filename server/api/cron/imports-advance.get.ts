import { createCronHttpHandler } from '~/server/services/scheduler'
import { IMPORTS_ADVANCE_TASK_NAME } from '~/server/services/scheduler/tasks/imports-advance'

export default createCronHttpHandler(IMPORTS_ADVANCE_TASK_NAME)
