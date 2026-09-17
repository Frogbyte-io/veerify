import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { businessHours, slaPolicy, slaTarget } from '~/server/database/schema/support'
import { buildSlaAssignment, selectSlaPolicy, type SlaPolicyCandidate } from './sla'

/** Resolve the current policy and compute deadlines for one conversation state. */
export async function resolveSlaAssignment(
  input: {
    teamId: string
    inboxId: string
    priority: string | null | undefined
    companyId: string | null | undefined
    tagIds: string[]
    start: Date
  },
  executor: Pick<typeof db, 'select'> = db
) {
  const policyRows = await executor
    .select({ policy: slaPolicy, hours: businessHours })
    .from(slaPolicy)
    .leftJoin(businessHours, eq(slaPolicy.businessHoursId, businessHours.id))
    .where(eq(slaPolicy.teamId, input.teamId))
    .orderBy(asc(slaPolicy.sortOrder), asc(slaPolicy.id))

  const selectedPolicy = selectSlaPolicy(
    policyRows.map(({ policy }) => policy as SlaPolicyCandidate),
    {
      inboxId: input.inboxId,
      priority: input.priority,
      tagIds: input.tagIds,
      companyId: input.companyId,
    }
  )
  if (!selectedPolicy) return null

  const selectedPolicyRow = policyRows.find(({ policy }) => policy.id === selectedPolicy.id)
  const targets = await executor
    .select({ metric: slaTarget.metric, priority: slaTarget.priority, targetMinutes: slaTarget.targetMinutes })
    .from(slaTarget)
    .where(eq(slaTarget.slaPolicyId, selectedPolicy.id))

  return buildSlaAssignment({
    policy: selectedPolicy,
    targets,
    start: input.start,
    priority: input.priority,
    businessHours: selectedPolicyRow?.hours
      ? {
          timezone: selectedPolicyRow.hours.timezone,
          weeklySchedule: selectedPolicyRow.hours.weeklySchedule,
          holidays: selectedPolicyRow.hours.holidays,
        }
      : null,
  })
}
