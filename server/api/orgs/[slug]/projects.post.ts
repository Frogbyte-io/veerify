import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { project, feedbackCategory } from '~/server/database/schema/feedback'
import { organization, member } from '~/server/database/schema/auth'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Project name too long'),
  slug: commonSchemas.slug,
  description: z.string().max(1000, 'Description too long').optional().nullable(),
  customDomain: z.string().max(253, 'Domain too long').optional().nullable(),
})

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

  const body = await validateBody(event, createProjectSchema)

  // Find organization by slug
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  // Verify user is a member of the org
  const [membership] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  // Check slug uniqueness within org
  const [existing] = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.slug, body.slug)))
    .limit(1)

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'A project with this slug already exists in this organization'),
    })
  }

  const projectId = crypto.randomUUID()
  const now = new Date()

  // Create the project
  const [created] = await db
    .insert(project)
    .values({
      id: projectId,
      organizationId: org.id,
      slug: body.slug,
      name: body.name,
      description: body.description || null,
      customDomain: body.customDomain || null,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Create default categories
  const defaultCategories = [
    { name: 'Feature Request', slug: 'feature-request', icon: 'lucide:lightbulb', color: '#10b981', isDefault: true },
    { name: 'Bug Report', slug: 'bug-report', icon: 'lucide:bug', color: '#ef4444', isDefault: false },
    { name: 'Improvement', slug: 'improvement', icon: 'lucide:trending-up', color: '#8b5cf6', isDefault: false },
  ]

  await db.insert(feedbackCategory).values(
    defaultCategories.map((cat, i) => ({
      id: crypto.randomUUID(),
      projectId: projectId,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon,
      color: cat.color,
      isDefault: cat.isDefault,
      sortOrder: i,
      createdAt: now,
    }))
  )

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
