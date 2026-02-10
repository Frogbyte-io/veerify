import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)

  const teamId = getRouterParam(event, 'teamId')
  const projectId = getRouterParam(event, 'projectId')

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Team ID is required'),
    })
  }

  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project ID is required'),
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

  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .limit(1)

  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found in this team'),
    })
  }

  await db.delete(project).where(eq(project.id, projectId))

  return createSuccessResponse({ id: projectId, deleted: true })
})
