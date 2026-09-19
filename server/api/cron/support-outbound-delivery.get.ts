import { createCronHttpHandler } from '~/server/services/scheduler'
import { OUTBOUND_DELIVERY_TASK_NAME } from '~/server/services/scheduler/tasks/outbound-delivery'

export default createCronHttpHandler(OUTBOUND_DELIVERY_TASK_NAME)
