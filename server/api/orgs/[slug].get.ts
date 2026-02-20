/**
 * Get Organization Endpoint
 * Retrieves organization details by slug
 *
 * @openapi
 * /api/orgs/{slug}:
 *   get:
 *     tags: [Organizations]
 *     summary: Get organization by slug
 *     description: Retrieves organization information including member count and metadata
 *     operationId: getOrganization
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: slug
 *         in: path
 *         description: Organization slug
 *         required: true
 *         schema:
 *           type: string
 *           pattern: ^[a-z0-9-]+$
 *     responses:
 *       200:
 *         description: Organization details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Organization'
 *                     - type: object
 *                       properties:
 *                         memberCount:
 *                           type: integer
 *                           description: Number of members in the organization
 *                         currentUserRole:
 *                           type: string
 *                           enum: [owner, admin, member]
 *                           description: Current user's role in the organization
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Not a member of this organization
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { getOrganizationDetails, requireOrganizationMembershipBySlug } from '~/server/utils/organization-access'

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
  const data = await getOrganizationDetails(org.id, session.user.id)

  return createSuccessResponse(data)
})
