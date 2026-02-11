import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { getOrganizationDetails } from '~/server/utils/organization-access'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session, activeTeam } = await requireAuthWithResolvedTeam(event)
  await requireRateLimit(event, rateLimits.standard)

  if (!activeTeam?.organizationId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'No active organization context'),
    })
  }

  const data = await getOrganizationDetails(activeTeam.organizationId, session.user.id)
  return createSuccessResponse(data)
})
