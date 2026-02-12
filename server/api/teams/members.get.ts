import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamMember, user } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { teamId } = validateQuery(event, querySchema)

  // Verify requesting user is a member of this team
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

  // Fetch all team members with user details
  const members = await db
    .select({
      id: teamMember.id,
      userId: teamMember.userId,
      role: teamMember.role,
      createdAt: teamMember.createdAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(teamMember)
    .innerJoin(user, eq(teamMember.userId, user.id))
    .where(eq(teamMember.teamId, teamId))

  return createSuccessResponse(members)
})
