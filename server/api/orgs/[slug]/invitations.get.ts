/**
 * @openapi
 * /api/orgs/{slug}/invitations:
 *   get:
 *     tags: [Organizations]
 *     summary: List pending invitations
 *     description: >
 *       Lists pending invitations for the organization, including expired ones (flagged `expired`) so they can be resent or revoked. Owners and admins only. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listOrganizationInvitations
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
 *       200: { description: "Array of { id, email, role, status, inviterName, expiresAt, createdAt, expired }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not an owner or admin" }
 *       404: { description: "Organization not found" }
 *       429: { description: "Rate limit exceeded" }
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { invitation, user } from '~/server/database/schema/auth'
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
      inviterName: user.name,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(and(eq(invitation.organizationId, org.id), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt))

  // Expired invitations stay listed: an admin who never saw them accepted needs a way to resend or revoke.
  const now = Date.now()
  return createSuccessResponse(
    pendingInvitations.map((inv) => ({ ...inv, expired: new Date(inv.expiresAt).getTime() <= now }))
  )
})
