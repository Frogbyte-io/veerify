import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { requireOrganizationMembershipBySlug, getOrganizationMembersWithTeams } from '~/server/utils/organization-access'

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

  const { org } = await requireOrganizationMembershipBySlug(session, slug)
  const data = await getOrganizationMembersWithTeams(org.id)

  return createSuccessResponse(data)
})
