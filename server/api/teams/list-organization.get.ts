import { and, asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { team, teamMember } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { ensureDefaultTeamMemberships } from '~/server/utils/team-membership'
import { resolveActiveTeamForSession } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await ensureDefaultTeamMemberships(session.user.id)

  let organizationId = session.session.activeOrganizationId || null
  if (!organizationId) {
    try {
      const activeTeam = await resolveActiveTeamForSession(session)
      organizationId = activeTeam.organizationId
    } catch {
      return createSuccessResponse([])
    }
  }

  const teams = await db
    .select({
      id: team.id,
      name: team.name,
      slug: team.slug,
      organizationId: team.organizationId,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      role: teamMember.role,
    })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(and(eq(teamMember.userId, session.user.id), eq(team.organizationId, organizationId)))
    .orderBy(asc(team.createdAt), asc(team.id))

  return createSuccessResponse(teams)
})
