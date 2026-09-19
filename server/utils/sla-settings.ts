import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { businessHours, slaPolicy, slaTarget } from '~/server/database/schema/support'

export async function loadSlaSettings(teamId: string) {
  const [hours, policyRows] = await Promise.all([
    db.select().from(businessHours).where(eq(businessHours.teamId, teamId)).orderBy(asc(businessHours.name)),
    db
      .select({ policy: slaPolicy, target: slaTarget })
      .from(slaPolicy)
      .leftJoin(slaTarget, eq(slaTarget.slaPolicyId, slaPolicy.id))
      .where(eq(slaPolicy.teamId, teamId))
      .orderBy(asc(slaPolicy.sortOrder), asc(slaPolicy.name), asc(slaTarget.metric), asc(slaTarget.priority)),
  ])

  const policies = new Map<
    string,
    { policy: typeof slaPolicy.$inferSelect; targets: (typeof slaTarget.$inferSelect)[] }
  >()
  for (const row of policyRows) {
    let grouped = policies.get(row.policy.id)
    if (!grouped) {
      grouped = { policy: row.policy, targets: [] }
      policies.set(row.policy.id, grouped)
    }
    if (row.target) grouped.targets.push(row.target)
  }

  return {
    businessHours: hours,
    policies: [...policies.values()].map(({ policy, targets }) => ({ ...policy, targets })),
  }
}
