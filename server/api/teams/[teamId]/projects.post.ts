import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project, feedbackCategory } from '~/server/database/schema/feedback'
import { team, teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Project name too long'),
  slug: commonSchemas.slug,
  description: z.string().max(1000, 'Description too long').optional().nullable(),
  customDomain: z.string().max(253, 'Domain too long').optional().nullable(),
})

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

  const body = await validateBody(event, createProjectSchema)

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

  const [selectedTeam] = await db.select().from(team).where(eq(team.id, teamId)).limit(1)
  if (!selectedTeam) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Team not found'),
    })
  }

  // Slugs stay unique at org URL namespace scope so public URLs remain /p/{orgSlug}/{projectSlug}.
  const [existing] = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, selectedTeam.organizationId), eq(project.slug, body.slug)))
    .limit(1)

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'A project with this slug already exists in your workspace URL namespace'
      ),
    })
  }

  const now = new Date()
  const projectId = crypto.randomUUID()

  const defaultCategories = [
    { name: 'Bug', slug: 'bug', icon: '🐛', color: '#ef4444', isDefault: true, description: 'Something isn’t working' },
    { name: 'Feature', slug: 'feature', icon: '✨', color: '#10b981', isDefault: true, description: 'A new capability or improvement' },
  ]

  const created = await db.transaction(async (tx) => {
    const [newProject] = await tx
      .insert(project)
      .values({
        id: projectId,
        organizationId: selectedTeam.organizationId,
        teamId: selectedTeam.id,
        slug: body.slug,
        name: body.name,
        description: body.description || null,
        customDomain: body.customDomain || null,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx.insert(feedbackCategory).values(
      defaultCategories.map((category, index) => ({
        id: crypto.randomUUID(),
        projectId,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        description: category.description,
        isDefault: category.isDefault,
        sortOrder: index,
        createdAt: now,
      }))
    )

    return newProject
  })

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
