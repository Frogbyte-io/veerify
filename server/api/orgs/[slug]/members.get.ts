/**
 * @openapi
 * /api/orgs/{slug}/members:
 *   get:
 *     tags: [Organizations]
 *     summary: List organization members
 *     description: >
 *       Lists the members of the organization. Any member may call it. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listOrganizationMembers
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Organization (workspace) slug"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Array of organization members with their roles" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a member" }
 *       404: { description: "Organization not found" }
 *       429: { description: "Rate limit exceeded" }
 */
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { requireOrganizationMembershipBySlug, getOrganizationMembers } from '~/server/utils/organization-access'

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
  const data = await getOrganizationMembers(org.id)

  return createSuccessResponse(data)
})
