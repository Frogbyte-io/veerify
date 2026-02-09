import { eq, and, count } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { project, feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { organization } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  if (!orgSlug || !projectSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization and project slugs are required'),
    })
  }

  // Find organization
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  // Find project within org
  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.slug, projectSlug)))
    .limit(1)

  if (!proj || !proj.isPublic) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  // Get feedback count
  const [feedbackCount] = await db.select({ count: count() }).from(feedback).where(eq(feedback.projectId, proj.id))

  // Get categories
  const categories = await db
    .select()
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, proj.id))
    .orderBy(feedbackCategory.sortOrder)

  // Get feedback count by status
  const statusCounts = await db
    .select({
      status: feedback.status,
      count: count(),
    })
    .from(feedback)
    .where(eq(feedback.projectId, proj.id))
    .groupBy(feedback.status)

  const statusMap: Record<string, number> = {}
  for (const s of statusCounts) {
    statusMap[s.status] = s.count
  }

  return createSuccessResponse({
    project: {
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      description: proj.description,
      customDomain: proj.customDomain,
      settings: proj.settings,
    },
    organization: {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
    },
    categories,
    stats: {
      total: feedbackCount?.count || 0,
      open: statusMap.open || 0,
      inProgress: statusMap.in_progress || 0,
      planned: statusMap.planned || 0,
      completed: statusMap.completed || 0,
    },
  })
})
