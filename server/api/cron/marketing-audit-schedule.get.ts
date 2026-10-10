import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_AUDIT_SCHEDULE_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-audit-schedule'

export default createCronHttpHandler(MARKETING_AUDIT_SCHEDULE_TASK_NAME)
