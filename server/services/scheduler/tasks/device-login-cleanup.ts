import { purgeExpiredDeviceAuthorizations } from '~/server/services/device-login'
import { defineScheduledTask } from '../registry'

/** Deletes device login requests that expired more than a day ago. */
export const DEVICE_LOGIN_CLEANUP_TASK_NAME = 'device-login:cleanup'

export const deviceLoginCleanupTask = defineScheduledTask(DEVICE_LOGIN_CLEANUP_TASK_NAME, '*/15 * * * *', async () => ({
  deleted: await purgeExpiredDeviceAuthorizations(),
}))
