import { eq, count } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { project, feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { organization } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project slug is required'),
    })
  }

  // Find project by slug - need to also handle org context
  // Query param orgSlug can disambiguate when same project slug exists in multiple orgs
  const orgSlug = getQuery(event).orgSlug as string | undefined

  let projects
  if (orgSlug) {
    const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
    if (!org) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
      })
    }
    projects = await db
      .select()
      .from(project)
      .where(eq(project.slug, slug))
      .innerJoin(organization, eq(project.organizationId, organization.id))
      .limit(1)
  } else {
    projects = await db
      .select()
      .from(project)
      .where(eq(project.slug, slug))
      .innerJoin(organization, eq(project.organizationId, organization.id))
      .limit(1)
  }

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
