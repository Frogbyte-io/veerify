/**
 * @openapi
 * /api/orgs/{slug}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Delete organization
 *     description: >
 *       Permanently deletes an organization and everything in it. Owners only. The body must repeat the slug as `confirmSlug`. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: deleteOrganization
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Organization (workspace) slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmSlug]
 *             properties:
 *               confirmSlug: { type: string, minLength: 1, description: "Must equal the organization slug" }
 *     responses:
 *       200: { description: "{ deleted: true, organizationId, slug }" }
 *       400: { description: "Validation failed or confirmSlug does not match" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not an owner" }
 *       404: { description: "Organization not found" }
 *       429: { description: "Rate limit exceeded" }
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { organization, session as sessionTable } from '~/server/database/schema/auth'
import { revokeGscTokensForOrganization } from '~/server/services/marketing/search/connection'
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

  // Revoke Google tokens while the connection rows still exist; best effort, never throws
  await revokeGscTokensForOrganization(org.id)

  await db.transaction(async (tx) => {
    await tx
      .update(sessionTable)
      .set({
        activeOrganizationId: null,
        activeProjectId: null,
      })
      .where(eq(sessionTable.activeOrganizationId, org.id))

    await tx.delete(organization).where(eq(organization.id, org.id))
  })

  return createSuccessResponse({
    deleted: true,
    organizationId: org.id,
    slug: org.slug,
  })
})
