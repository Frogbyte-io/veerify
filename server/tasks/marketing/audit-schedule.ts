import { marketingAuditScheduleTask } from '~/server/services/scheduler/tasks/marketing-audit-schedule'

export default defineTask({
  meta: {
    name: 'marketing:audit-schedule',
    description: 'Queue first and weekly marketing site audits for verified sites.',
  },
  async run() {
    const result = await marketingAuditScheduleTask.handler()
    return { result }
  },
})
