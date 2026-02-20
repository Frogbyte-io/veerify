import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { organization, session as sessionTable, team } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireOrganizationRoleBySlug } from '~/server/utils/organization-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const deleteOrganizationSchema = z.object({
  confirmSlug: z.string().trim().min(1, 'Organization slug confirmation is required'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization slug is required'),
    })
  }

  const body = await validateBody(event, deleteOrganizationSchema)
  const { org } = await requireOrganizationRoleBySlug(session, slug, ['owner'])

  if (body.confirmSlug !== org.slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Confirmation slug does not match organization slug'),
    })
  }

  await db.transaction(async (tx) => {
    const teams = await tx.select({ id: team.id }).from(team).where(eq(team.organizationId, org.id))

    const teamIds = teams.map((item) => item.id)

    await tx
      .update(sessionTable)
      .set({
        activeOrganizationId: null,
        activeTeamId: null,
      })
      .where(eq(sessionTable.activeOrganizationId, org.id))

    if (teamIds.length > 0) {
      await tx
        .update(sessionTable)
        .set({ activeTeamId: null })
        .where(and(inArray(sessionTable.activeTeamId, teamIds), isNull(sessionTable.activeOrganizationId)))
    }

    await tx.delete(organization).where(eq(organization.id, org.id))
  })

  return createSuccessResponse({
    deleted: true,
    organizationId: org.id,
    slug: org.slug,
  })
})
