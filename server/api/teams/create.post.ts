import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { team, teamMember, member } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'
import { isReservedSlug } from '~/server/utils/reserved-slugs'
import { registerTeamPublicDomainBestEffort } from '~/server/services/domains/domain-service'

const createTeamSchema = z.object({
  name: z.string().min(1, 'Team name is required').max(100, 'Team name too long'),
  slug: commonSchemas.slug,
  organizationId: z.string().min(1, 'Organization ID is required'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const body = await validateBody(event, createTeamSchema)

  if (isReservedSlug(body.slug)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'This slug is reserved and cannot be used'),
    })
  }

  // Verify user is a member of the organization
  const [orgMembership] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, body.organizationId), eq(member.userId, session.user.id)))
    .limit(1)

  if (!orgMembership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this organization'),
    })
  }

  // Check slug is globally unique
  const [existing] = await db.select().from(team).where(eq(team.slug, body.slug)).limit(1)
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'A team with this slug already exists'),
    })
  }

  const now = new Date()
  const newTeamId = crypto.randomUUID()

  const [newTeam] = await db
    .insert(team)
    .values({
      id: newTeamId,
      name: body.name,
      slug: body.slug,
      organizationId: body.organizationId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  await db.insert(teamMember).values({
    id: crypto.randomUUID(),
    teamId: newTeamId,
    userId: session.user.id,
    role: 'admin',
    createdAt: now,
  })

  await registerTeamPublicDomainBestEffort(newTeam.slug, { teamId: newTeam.id })

  setResponseStatus(event, 201)
  return createSuccessResponse(newTeam)
})
