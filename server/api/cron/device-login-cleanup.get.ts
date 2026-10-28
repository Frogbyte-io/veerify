import { createCronHttpHandler } from '~/server/services/scheduler'
import { DEVICE_LOGIN_CLEANUP_TASK_NAME } from '~/server/services/scheduler/tasks/device-login-cleanup'

export default createCronHttpHandler(DEVICE_LOGIN_CLEANUP_TASK_NAME)
