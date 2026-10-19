import { describe, expect, it, vi } from 'vitest'
import {
  appliedAutomationActions,
  executeAutomationActions,
  failedAutomationActions,
} from '~/server/utils/automation-actions'

describe('automation action executor', () => {
  it('runs actions in order and isolates a failing action', async () => {
    const calls: string[] = []
    const executions = await executeAutomationActions(
      [
        { type: 'set_priority', value: 'urgent' },
        { type: 'call_webhook', url: 'https://example.test/hook' },
        { type: 'add_tag', tag: 'escalated' },
      ],
      { conversationId: 'conversation-1' },
      {
        set_priority: async () => {
          calls.push('priority')
        },
        call_webhook: async () => {
          calls.push('webhook')
          throw new Error('webhook unavailable')
        },
        add_tag: async () => {
          calls.push('tag')
        },
      }
    )

    expect(calls).toEqual(['priority', 'webhook', 'tag'])
    expect(executions.map((execution) => execution.status)).toEqual(['applied', 'failed', 'applied'])
    expect(failedAutomationActions(executions)[0]?.error).toBe('webhook unavailable')
    expect(appliedAutomationActions(executions).map((action) => action.type)).toEqual(['set_priority', 'add_tag'])
  })

  it('records missing handlers and malformed actions without throwing', async () => {
    const executions = await executeAutomationActions(
      [{ type: 'unknown' }, {} as { type: string }],
      { conversationId: 'conversation-2' },
      {}
    )

    expect(executions).toHaveLength(2)
    expect(executions.every((execution) => execution.status === 'failed')).toBe(true)
    expect(executions[0]?.error).toContain('No handler registered')
    expect(executions[1]?.error).toBe('Automation action type is required')
  })

  it('accepts an explicit handler failure result and passes context through', async () => {
    const handler = vi.fn((_action, context) => {
      expect(context.cascadeDepth).toBe(2)
      return { success: false, error: 'rate limited' }
    })
    const executions = await executeAutomationActions(
      [{ type: 'call_webhook' }],
      { conversationId: 'conversation-3', cascadeDepth: 2 },
      { call_webhook: handler }
    )

    expect(handler).toHaveBeenCalledOnce()
    expect(executions[0]).toMatchObject({ status: 'failed', error: 'rate limited' })
  })
})
