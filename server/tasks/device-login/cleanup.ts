import { deviceLoginCleanupTask } from '~/server/services/scheduler/tasks/device-login-cleanup'

export default defineTask({
  meta: {
    name: 'device-login:cleanup',
    description: 'Delete device login requests that expired more than a day ago.',
  },
  async run() {
    const result = await deviceLoginCleanupTask.handler()
    return { result }
  },
})
