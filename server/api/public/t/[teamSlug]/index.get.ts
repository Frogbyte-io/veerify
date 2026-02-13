import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { team } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')

  if (!teamSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Team slug is required'),
    })
  }

  const [t] = await db.select().from(team).where(eq(team.slug, teamSlug)).limit(1)
  if (!t) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Team not found'),
    })
  }

  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.teamId, t.id), eq(project.isPublic, true)))
    .orderBy(project.createdAt)

  return createSuccessResponse({
    team: {
      id: t.id,
      name: t.name,
      slug: t.slug,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      settings: p.settings,
    })),
  })
})
