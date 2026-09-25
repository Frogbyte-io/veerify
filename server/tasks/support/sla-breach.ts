import { slaBreachTask } from '~/server/services/scheduler/tasks/sla-breach'

export default defineTask({
  meta: {
    name: 'support:sla-breach',
    description: 'Stamp overdue SLA metrics and dispatch once-only escalation notifications.',
  },
  async run() {
    const result = await slaBreachTask.handler()
    return { result }
  },
})
