import { asc, inArray } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { team } from '~/server/database/schema/auth'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Serialize contact lifecycle mutations within each owning team.
 *
 * Every contact create, update, delete, merge, link, and automatic-link
 * operation acquires this stable team-row lock before touching contact-owned
 * state. Auto-link policy updates use it too, making a committed setting the
 * clear boundary for later link decisions. A caller may pass multiple teams;
 * sorting keeps cross-team acquisition deterministic.
 */
export async function lockContactTeams(tx: Transaction, teamIds: string[]): Promise<void> {
  const orderedTeamIds = [...new Set(teamIds)].sort()
  if (orderedTeamIds.length === 0) return

  await tx
    .select({ id: team.id })
    .from(team)
    .where(inArray(team.id, orderedTeamIds))
    .orderBy(asc(team.id))
    .for('update')
}

export async function lockContactTeam(tx: Transaction, teamId: string): Promise<void> {
  await lockContactTeams(tx, [teamId])
}
