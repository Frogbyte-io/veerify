import { automationRulesTask } from '~/server/services/scheduler/tasks/automation-rules'

export default defineTask({
  meta: {
    name: 'support:automation-rules',
    description: 'Evaluate enabled time-based support automation rules.',
  },
  async run() {
    const result = await automationRulesTask.handler()
    return { result }
  },
})
