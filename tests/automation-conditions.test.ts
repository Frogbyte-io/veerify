import { describe, expect, it } from 'vitest'
import {
  evaluateAutomationConditions,
  matchesAutomationConditions,
  type AutomationConversationContext,
} from '~/server/utils/automation-conditions'

const context: AutomationConversationContext = {
  inboxId: 'inbox-enterprise',
  status: 'open',
  priority: 'urgent',
  tagIds: ['enterprise', 'billing'],
  assigneeUserId: 'agent-1',
  companyId: 'company-acme',
  subject: 'Production outage',
  body: 'The checkout is failing for every customer',
  channel: 'email',
  hoursSinceLastActivity: 3,
  slaState: 'breaching',
}

describe('automation condition evaluator', () => {
  it('evaluates scalar conditions and all/any groups', () => {
    expect(
      evaluateAutomationConditions(
        {
          all: [
            { field: 'company', value: 'company-acme' },
            {
              any: [
                { field: 'priority', value: 'high' },
                { field: 'priority', value: 'urgent' },
              ],
            },
          ],
        },
        context
      )
    ).toBe(true)
    expect(evaluateAutomationConditions({ all: [{ field: 'status', value: 'closed' }] }, context)).toBe(false)
  })

  it('supports tags, text matching, and numeric comparisons', () => {
    expect(evaluateAutomationConditions({ all: [{ field: 'tag', value: 'enterprise' }] }, context)).toBe(true)
    expect(
      evaluateAutomationConditions(
        {
          all: [
            { field: 'subject', operator: 'contains', value: 'OUTAGE' },
            { field: 'hours_since_last_activity', operator: 'greater_than_or_equal', value: 3 },
          ],
        },
        context
      )
    ).toBe(true)
    expect(
      evaluateAutomationConditions({ all: [{ field: 'body', operator: 'matches', value: '^The checkout' }] }, context)
    ).toBe(true)
  })

  it('allows one nested group but rejects deeper nesting', () => {
    expect(
      evaluateAutomationConditions(
        {
          any: [
            {
              all: [
                { field: 'priority', value: 'urgent' },
                { field: 'status', value: 'open' },
              ],
            },
          ],
        },
        context
      )
    ).toBe(true)

    expect(
      evaluateAutomationConditions(
        {
          all: [
            {
              any: [
                {
                  all: [{ field: 'priority', value: 'urgent' }],
                },
              ],
            },
          ],
        },
        context
      )
    ).toBe(false)
  })

  it('supports custom fields through the registry', () => {
    expect(
      matchesAutomationConditions(
        { all: [{ field: 'customer_plan', value: 'enterprise' }] },
        { ...context, customerPlan: 'enterprise' },
        {
          customer_plan: (condition, values) => condition.value === values.customerPlan,
        }
      )
    ).toBe(true)
  })

  it('treats empty conditions as a match and empty any as a miss', () => {
    expect(evaluateAutomationConditions({}, context)).toBe(true)
    expect(evaluateAutomationConditions({ all: [] }, context)).toBe(true)
    expect(evaluateAutomationConditions({ any: [] }, context)).toBe(false)
  })
})
