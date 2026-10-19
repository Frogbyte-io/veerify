import { marketingCompetitorsCheckTask } from '~/server/services/scheduler/tasks/marketing-competitors-check'

export default defineTask({
  meta: {
    name: 'marketing:competitors-check',
    description: 'Check watched competitor pages for changes (robots.txt respected, at most daily per page).',
  },
  async run() {
    const result = await marketingCompetitorsCheckTask.handler()
    return { result }
  },
})
