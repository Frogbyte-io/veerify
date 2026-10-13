import { marketingAuditAdvanceTask } from '~/server/services/scheduler/tasks/marketing-audit-advance'

export default defineTask({
  meta: {
    name: 'marketing:audit-advance',
    description: 'Advance running marketing site audits (poll crawl jobs, analyze, score).',
  },
  async run() {
    const result = await marketingAuditAdvanceTask.handler()
    return { result }
  },
})
