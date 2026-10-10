import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_AUDIT_ADVANCE_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-audit-advance'

export default createCronHttpHandler(MARKETING_AUDIT_ADVANCE_TASK_NAME)
