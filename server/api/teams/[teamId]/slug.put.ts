import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { team, teamMember } from '~/server/database/schema/auth'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'
import { isReservedSlug } from '~/server/utils/reserved-slugs'

const updateSlugSchema = z.object({
  slug: commonSchemas.slug,
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

  const body = await validateBody(event, updateSlugSchema)

  if (isReservedSlug(body.slug)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'This slug is reserved and cannot be used'),
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

  const [conflict] = await db.select().from(team).where(eq(team.slug, body.slug)).limit(1)

  if (conflict && conflict.id !== teamId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'A team with this slug already exists'),
    })
  }

  const [updated] = await db
    .update(team)
    .set({ slug: body.slug, updatedAt: new Date() })
    .where(eq(team.id, teamId))
    .returning()

  return createSuccessResponse(updated)
})
