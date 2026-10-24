/**
 * @openapi
 * /api/public/o/{orgSlug}:
 *   get:
 *     tags: [Public]
 *     summary: Public projects of a workspace
 *     operationId: getPublicOrganization
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ organization, projects }`" }
 *       404: { description: Workspace not found }
 */
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { organization } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')

  if (!orgSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Workspace slug is required'),
    })
  }

  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Workspace not found'),
    })
  }

  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.isPublic, true)))
    .orderBy(project.createdAt)

  return createSuccessResponse({
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
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
