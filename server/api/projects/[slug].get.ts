import { and, count, eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { db } from '~/server/database/drizzle'
import { project, feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { organization, teamMember } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const { session, activeTeam } = await requireAuthWithResolvedTeam(event)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project slug is required'),
    })
  }

  const requestedTeamId = getQuery(event).teamId as string | undefined
  const teamId = requestedTeamId || activeTeam.id

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

  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.teamId, teamId), eq(project.slug, slug)))
    .innerJoin(organization, eq(project.organizationId, organization.id))
    .limit(1)

  if (!projects.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  const p = projects[0]

  // Get feedback count
  const [feedbackCount] = await db.select({ count: count() }).from(feedback).where(eq(feedback.projectId, p.project.id))

  // Get categories
  const categories = await db.select().from(feedbackCategory).where(eq(feedbackCategory.projectId, p.project.id))

  return createSuccessResponse({
    ...p.project,
    feedbackCount: feedbackCount?.count || 0,
    organization: p.organization,
    categories,
  })
})
