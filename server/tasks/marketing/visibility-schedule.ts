import { marketingVisibilityScheduleTask } from '~/server/services/scheduler/tasks/marketing-visibility-schedule'

export default defineTask({
  meta: {
    name: 'marketing:visibility-schedule',
    description: 'Start weekly AI visibility runs for eligible sites.',
  },
  async run() {
    const result = await marketingVisibilityScheduleTask.handler()
    return { result }
  },
})
