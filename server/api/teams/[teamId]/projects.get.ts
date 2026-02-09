import { and, count, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project, feedback } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)

  const teamId = getRouterParam(event, 'teamId')
  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Team ID is required'),
    })
  }

  const [membership] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this team'),
    })
  }

  const projects = await db.select().from(project).where(eq(project.teamId, teamId))

  const projectsWithCounts = await Promise.all(
    projects.map(async (p) => {
      const [result] = await db.select({ count: count() }).from(feedback).where(eq(feedback.projectId, p.id))
      return {
        ...p,
        feedbackCount: result?.count || 0,
      }
    })
  )

  return createSuccessResponse(projectsWithCounts)
})
