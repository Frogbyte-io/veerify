import { marketingVisibilityAdvanceTask } from '~/server/services/scheduler/tasks/marketing-visibility-advance'

export default defineTask({
  meta: {
    name: 'marketing:visibility-advance',
    description: 'Advance queued AI visibility runs within a time budget.',
  },
  async run() {
    const result = await marketingVisibilityAdvanceTask.handler()
    return { result }
  },
})
