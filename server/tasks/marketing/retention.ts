import { marketingRetentionTask } from '~/server/services/scheduler/tasks/marketing-retention'

export default defineTask({
  meta: {
    name: 'marketing:retention',
    description: 'Delete aged-out review requests, testimonial emails, competitor changes and usage counters.',
  },
  async run() {
    const result = await marketingRetentionTask.handler()
    return { result }
  },
})
