import { mailForwardUsageTask } from '~/server/services/scheduler/tasks/mail-forward-usage'

export default defineTask({
  meta: {
    name: 'mail:forward-usage',
    description: 'Pause email forwarding at the monthly limit; resume after a new month or tier change.',
  },
  async run() {
    const result = await mailForwardUsageTask.handler()
    return { result }
  },
})
