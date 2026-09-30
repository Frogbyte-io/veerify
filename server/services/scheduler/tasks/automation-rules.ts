import { runTimeBasedAutomationSweep } from '~/server/utils/automation-engine'
import { defineScheduledTask } from '../registry'

export const AUTOMATION_RULES_TASK_NAME = 'support:automation-rules'

export const automationRulesTask = defineScheduledTask(AUTOMATION_RULES_TASK_NAME, '*/5 * * * *', () =>
  runTimeBasedAutomationSweep()
)
