import { marketingMentionsDigestTask } from '~/server/services/scheduler/tasks/marketing-mentions-digest'

export default defineTask({
  meta: {
    name: 'marketing:mentions-digest',
    description: 'Email team admins a daily digest of new marketing mentions.',
  },
  async run() {
    const result = await marketingMentionsDigestTask.handler()
    return { result }
  },
})
