import type {
  AutomationCondition,
  AutomationConditionGroup,
  AutomationConditionNode,
  AutomationConditionOperator,
} from '~/server/database/schema/support'

/** Values exposed to the built-in condition registry for one conversation. */
export type AutomationConversationContext = {
  inboxId?: string | null
  status?: string | null
  priority?: string | null
  tagIds?: readonly string[]
  assigneeUserId?: string | null
  contactId?: string | null
  companyId?: string | null
  subject?: string | null
  body?: string | null
  channel?: string | null
  hoursSinceLastActivity?: number | null
  slaState?: string | null
  [key: string]: unknown
}

// The tuple keeps the callback signature named-parameter-free for lint while preserving both argument types.
// eslint-disable-next-line no-unused-vars
export type AutomationConditionEvaluator = (...args: [AutomationCondition, AutomationConversationContext]) => boolean

export type AutomationConditionRegistry = Readonly<Record<string, AutomationConditionEvaluator>>

const OPERATOR_ALIASES: Record<string, AutomationConditionOperator> = {
  eq: 'equals',
  equal: 'equals',
  equals: 'equals',
  neq: 'not_equals',
  ne: 'not_equals',
  not_equal: 'not_equals',
  not_equals: 'not_equals',
  in: 'in',
  not_in: 'not_in',
  contains: 'contains',
  not_contains: 'not_contains',
  starts_with: 'starts_with',
  ends_with: 'ends_with',
  matches: 'matches',
  regex: 'matches',
  gt: 'greater_than',
  greater_than: 'greater_than',
  gte: 'greater_than_or_equal',
  greater_than_or_equal: 'greater_than_or_equal',
  lt: 'less_than',
  less_than: 'less_than',
  lte: 'less_than_or_equal',
  less_than_or_equal: 'less_than_or_equal',
}

function normalizeOperator(operator: unknown): AutomationConditionOperator {
  if (typeof operator !== 'string' || !operator.trim()) return 'equals'
  return OPERATOR_ALIASES[operator.trim().toLowerCase()] || (operator.trim() as AutomationConditionOperator)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : value === null || value === undefined ? null : String(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase()
  return left === right
}

function includesValue(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(haystack)) return haystack.some((value) => valuesEqual(value, needle))
  if (typeof haystack === 'string' && typeof needle === 'string') {
    return haystack.toLowerCase().includes(needle.toLowerCase())
  }
  return false
}

function compareValues(actual: unknown, operator: AutomationConditionOperator, expected: unknown): boolean {
  switch (normalizeOperator(operator)) {
    case 'equals':
      return Array.isArray(actual)
        ? actual.some((value) => valuesEqual(value, expected))
        : valuesEqual(actual, expected)
    case 'not_equals':
      return !compareValues(actual, 'equals', expected)
    case 'in':
      return Array.isArray(expected) && expected.some((value) => valuesEqual(actual, value))
    case 'not_in':
      return !compareValues(actual, 'in', expected)
    case 'contains':
      return includesValue(actual, expected)
    case 'not_contains':
      return !includesValue(actual, expected)
    case 'starts_with': {
      const actualText = asString(actual)
      const expectedText = asString(expected)
      return (
        actualText !== null && expectedText !== null && actualText.toLowerCase().startsWith(expectedText.toLowerCase())
      )
    }
    case 'ends_with': {
      const actualText = asString(actual)
      const expectedText = asString(expected)
      return (
        actualText !== null && expectedText !== null && actualText.toLowerCase().endsWith(expectedText.toLowerCase())
      )
    }
    case 'matches': {
      const actualText = asString(actual)
      if (actualText === null || typeof expected !== 'string') return false
      try {
        return new RegExp(expected, 'i').test(actualText)
      } catch {
        return false
      }
    }
    case 'greater_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'greater_than_or_equal':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'less_than':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'less_than_or_equal':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    default:
      return false
  }
}

function contextValue(field: string, context: AutomationConversationContext): unknown {
  const values: Record<string, unknown> = {
    inbox: context.inboxId,
    inbox_id: context.inboxId,
    status: context.status,
    priority: context.priority,
    tag: context.tagIds,
    tag_id: context.tagIds,
    assignee: context.assigneeUserId,
    assignee_user_id: context.assigneeUserId,
    contact: context.contactId,
    contact_id: context.contactId,
    company: context.companyId,
    company_id: context.companyId,
    subject: context.subject,
    body: context.body,
    channel: context.channel,
    hours_since_last_activity: context.hoursSinceLastActivity,
    sla_state: context.slaState,
  }
  return Object.prototype.hasOwnProperty.call(values, field) ? values[field] : context[field]
}

function evaluateDefaultCondition(condition: AutomationCondition, context: AutomationConversationContext): boolean {
  const actual = contextValue(condition.field, context)
  const operator = condition.operator || (Array.isArray(actual) ? 'contains' : 'equals')
  return compareValues(actual, operator, condition.value)
}

/** The built-in registry is deliberately field-based so later stages can add fields without changing the engine. */
const builtInConditionFields = [
  'inbox',
  'inbox_id',
  'status',
  'priority',
  'tag',
  'tag_id',
  'assignee',
  'assignee_user_id',
  'contact',
  'contact_id',
  'company',
  'company_id',
  'subject',
  'body',
  'channel',
  'hours_since_last_activity',
  'sla_state',
] as const

export const automationConditionRegistry: AutomationConditionRegistry = Object.fromEntries(
  builtInConditionFields.map((field) => [
    field,
    (condition: AutomationCondition, context: AutomationConversationContext) => {
      if (field === 'tag' || field === 'tag_id') {
        return compareValues(context.tagIds || [], condition.operator || 'contains', condition.value)
      }
      return evaluateDefaultCondition(condition, context)
    },
  ])
) as AutomationConditionRegistry

function isConditionGroup(node: AutomationConditionNode | unknown): node is AutomationConditionGroup {
  return Boolean(node && typeof node === 'object' && ('all' in node || 'any' in node))
}

function isCondition(node: AutomationConditionNode | unknown): node is AutomationCondition {
  return Boolean(node && typeof node === 'object' && typeof (node as AutomationCondition).field === 'string')
}

function evaluateNode(
  node: AutomationConditionNode,
  context: AutomationConversationContext,
  registry: AutomationConditionRegistry,
  depth: number
): boolean {
  if (isCondition(node)) {
    const evaluator = registry[node.field]
    return evaluator ? evaluator(node, context) : evaluateDefaultCondition(node, context)
  }
  if (!isConditionGroup(node) || depth > 1) return false

  const groups: boolean[] = []
  if (Array.isArray(node.all)) groups.push(node.all.every((child) => evaluateNode(child, context, registry, depth + 1)))
  if (Array.isArray(node.any)) groups.push(node.any.some((child) => evaluateNode(child, context, registry, depth + 1)))
  if (groups.length === 0) return true
  if (Array.isArray(node.all) && Array.isArray(node.any)) return groups.every(Boolean)
  return groups[0]
}

/** Evaluate an automation rule's conditions without touching persistence or runtime state. */
export function evaluateAutomationConditions(
  conditions: AutomationConditionGroup | readonly AutomationConditionNode[] | null | undefined,
  context: AutomationConversationContext,
  registry: AutomationConditionRegistry = automationConditionRegistry
): boolean {
  if (!conditions) return true
  if (Array.isArray(conditions)) {
    return conditions.every((condition) => evaluateNode(condition, context, registry, 0))
  }
  if (typeof conditions === 'object' && Object.keys(conditions).length === 0) return true
  if (!isConditionGroup(conditions)) return false
  return evaluateNode(conditions, context, registry, 0)
}

export const matchesAutomationConditions = evaluateAutomationConditions
