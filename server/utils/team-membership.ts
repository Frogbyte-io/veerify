import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, team, teamMember } from '~/server/database/schema/auth'
import { DEFAULT_TEAM_NAME } from '~/server/utils/team-context'

/**
 * Backfills missing memberships to an organization's default team.
 * This keeps older data consistent with current workspace expectations.
 */
export async function ensureDefaultTeamMemberships(userId: string) {
  const organizationMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  if (organizationMemberships.length === 0) {
    return
  }

  const organizationIds = Array.from(new Set(organizationMemberships.map((row) => row.organizationId)))

  const defaultTeams = await db
    .select({ id: team.id, organizationId: team.organizationId })
    .from(team)
    .where(and(inArray(team.organizationId, organizationIds), eq(team.name, DEFAULT_TEAM_NAME)))

  if (defaultTeams.length === 0) {
    return
  }

  const defaultTeamIds = defaultTeams.map((row) => row.id)
  const existingMemberships = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, userId), inArray(teamMember.teamId, defaultTeamIds)))

  const existingTeamIds = new Set(existingMemberships.map((row) => row.teamId))
  const missingDefaultTeams = defaultTeams.filter((row) => !existingTeamIds.has(row.id))

  if (missingDefaultTeams.length === 0) {
    return
  }

  await db.insert(teamMember).values(
    missingDefaultTeams.map((row) => ({
      id: crypto.randomUUID(),
      teamId: row.id,
      userId,
      role: 'member',
      createdAt: new Date(),
    }))
  )
}
