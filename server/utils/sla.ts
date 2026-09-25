import { addBusinessMinutes, type BusinessHoursConfig } from './business-hours'
import type { SlaConditions } from '~/server/database/schema/support'

export type SlaPolicyCandidate = {
  id: string
  conditions: SlaConditions
  isDefault: boolean
  sortOrder: number
}

export type SlaPolicyContext = {
  inboxId: string
  priority: string | null | undefined
  tagIds: string[]
  companyId: string | null | undefined
}

export type SlaTargetCandidate = {
  metric: 'first_response' | 'next_response' | 'resolution' | string
  priority: string | null
  targetMinutes: number
}

const METRICS = ['first_response', 'next_response', 'resolution'] as const
export type SlaMetric = (typeof METRICS)[number]

function matchesValues(values: string[] | undefined, value: string | null | undefined): boolean {
  return !values || values.length === 0 || (value !== null && value !== undefined && values.includes(value))
}

/**
 * Match one policy against the current conversation attributes.
 * Multiple tag conditions use any-match semantics: a policy that names tags
 * A and B applies when the conversation carries either tag.
 */
export function matchesSlaPolicy(policy: Pick<SlaPolicyCandidate, 'conditions'>, context: SlaPolicyContext): boolean {
  const conditions = policy.conditions || {}
  return (
    matchesValues(conditions.inboxIds, context.inboxId) &&
    matchesValues(conditions.priorities, context.priority) &&
    matchesValues(conditions.companyIds, context.companyId) &&
    (!conditions.tagIds ||
      conditions.tagIds.length === 0 ||
      conditions.tagIds.some((id) => context.tagIds.includes(id)))
  )
}

/**
 * Select the first matching non-default policy by sort order. A default policy
 * is only considered after all conditional policies have been checked.
 */
export function selectSlaPolicy(
  policies: readonly SlaPolicyCandidate[],
  context: SlaPolicyContext
): SlaPolicyCandidate | null {
  const ordered = policies
    .map((policy, index) => ({ policy, index }))
    .sort((a, b) => a.policy.sortOrder - b.policy.sortOrder || a.index - b.index)

  const conditional = ordered.find(({ policy }) => !policy.isDefault && matchesSlaPolicy(policy, context))
  if (conditional) return conditional.policy

  return ordered.find(({ policy }) => policy.isDefault)?.policy ?? null
}

/** Pick an exact-priority target, falling back to the policy's catch-all target. */
export function selectSlaTarget(
  targets: readonly SlaTargetCandidate[],
  metric: SlaMetric,
  priority: string | null | undefined
): SlaTargetCandidate | null {
  const metricTargets = targets.filter((target) => target.metric === metric)
  if (priority !== null && priority !== undefined) {
    const exact = metricTargets.find((target) => target.priority === priority)
    if (exact) return exact
  }
  return metricTargets.find((target) => target.priority === null) ?? null
}

export function addSlaMinutes(start: Date, targetMinutes: number, businessHours?: BusinessHoursConfig | null): Date {
  if (!Number.isInteger(targetMinutes) || targetMinutes < 0) {
    throw new Error('SLA target must be a non-negative integer')
  }
  if (businessHours) return addBusinessMinutes(start, targetMinutes, businessHours)
  return new Date(start.getTime() + targetMinutes * 60_000)
}

/** Compute all metric deadlines from one event timestamp. */
export function calculateSlaDueDates(
  start: Date,
  targets: readonly SlaTargetCandidate[],
  priority: string | null | undefined,
  businessHours?: BusinessHoursConfig | null
): Record<SlaMetric, Date | null> {
  return Object.fromEntries(
    METRICS.map((metric) => {
      const target = selectSlaTarget(targets, metric, priority)
      return [metric, target ? addSlaMinutes(start, target.targetMinutes, businessHours) : null]
    })
  ) as Record<SlaMetric, Date | null>
}

export type SlaAssignment = {
  slaPolicyId: string
  firstResponseDueAt: Date | null
  nextResponseDueAt: Date | null
  resolutionDueAt: Date | null
}

export function buildSlaAssignment(input: {
  policy: SlaPolicyCandidate
  targets: readonly SlaTargetCandidate[]
  start: Date
  priority: string | null | undefined
  businessHours?: BusinessHoursConfig | null
  includeNextResponse?: boolean
}): SlaAssignment {
  const due = calculateSlaDueDates(input.start, input.targets, input.priority, input.businessHours)
  return {
    slaPolicyId: input.policy.id,
    firstResponseDueAt: due.first_response,
    // There is no pending response obligation until the first customer reply
    // after an agent response. The runtime fills this when that event occurs.
    nextResponseDueAt: input.includeNextResponse ? due.next_response : null,
    resolutionDueAt: due.resolution,
  }
}
