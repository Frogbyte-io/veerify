import { and, eq, gt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { invitation, team, user } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireOrganizationRoleBySlug } from '~/server/utils/organization-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'

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

  const { org } = await requireOrganizationRoleBySlug(session, slug, ['owner', 'admin'])

  const pendingInvitations = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      teamId: invitation.teamId,
      teamName: team.name,
      inviterName: user.name,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .leftJoin(team, eq(invitation.teamId, team.id))
    .where(and(eq(invitation.organizationId, org.id), eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())))

  return createSuccessResponse(pendingInvitations)
})
