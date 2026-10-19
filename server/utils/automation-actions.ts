import type { AutomationRuleAction } from '~/server/database/schema/support'

export type AutomationActionContext = {
  conversationId: string
  teamId?: string
  inboxId?: string
  actorUserId?: string
  cascadeDepth?: number
  [key: string]: unknown
}

export type AutomationActionHandlerResult = {
  success?: boolean
  error?: string
}

export type AutomationActionHandler = (
  // eslint-disable-next-line no-unused-vars
  ...args: [AutomationRuleAction, AutomationActionContext]
) => unknown | Promise<unknown>

export type AutomationActionRegistry = Readonly<Record<string, AutomationActionHandler>>

export type AutomationActionExecution = {
  index: number
  action: AutomationRuleAction
  status: 'applied' | 'failed'
  error?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Automation action failed'
}

/**
 * Run actions in their declared order. A handler failure is captured against
 * that action and does not prevent later actions from running.
 */
export async function executeAutomationActions(
  actions: readonly AutomationRuleAction[] | null | undefined,
  context: AutomationActionContext,
  registry: AutomationActionRegistry = {}
): Promise<AutomationActionExecution[]> {
  if (!actions?.length) return []

  const executions: AutomationActionExecution[] = []
  for (const [index, action] of actions.entries()) {
    if (!action || typeof action.type !== 'string' || !action.type.trim()) {
      executions.push({ index, action, status: 'failed', error: 'Automation action type is required' })
      continue
    }

    const handler = registry[action.type]
    if (!handler) {
      executions.push({
        index,
        action,
        status: 'failed',
        error: `No handler registered for automation action "${action.type}"`,
      })
      continue
    }

    try {
      const result = await handler(action, context)
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        const actionResult = result as AutomationActionHandlerResult
        executions.push({ index, action, status: 'failed', error: actionResult.error || 'Automation action failed' })
      } else {
        executions.push({ index, action, status: 'applied' })
      }
    } catch (error) {
      executions.push({ index, action, status: 'failed', error: errorMessage(error) })
    }
  }

  return executions
}

export function appliedAutomationActions(executions: readonly AutomationActionExecution[]): AutomationRuleAction[] {
  return executions.filter((execution) => execution.status === 'applied').map((execution) => execution.action)
}

export function failedAutomationActions(executions: readonly AutomationActionExecution[]): AutomationActionExecution[] {
  return executions.filter((execution) => execution.status === 'failed')
}
