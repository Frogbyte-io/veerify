import { eq, count } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { project, feedback } from '~/server/database/schema/feedback'
import { organization, member } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const orgSlug = getRouterParam(event, 'slug')
  if (!orgSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization slug is required'),
    })
  }

  // Find organization by slug
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  // Verify user is a member
  const [membership] = await db
    .select()
    .from(member)
    .where(eq(member.organizationId, org.id))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  // Get all projects for this org
  const projects = await db.select().from(project).where(eq(project.organizationId, org.id))

  // Get feedback counts per project
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
