import { marketingMentionsPollTask } from '~/server/services/scheduler/tasks/marketing-mentions-poll'

export default defineTask({
  meta: {
    name: 'marketing:mentions-poll',
    description: 'Poll Hacker News, Reddit and Bluesky for brand, competitor and keyword mentions.',
  },
  async run() {
    const result = await marketingMentionsPollTask.handler()
    return { result }
  },
})
