/**
 * @openapi
 * /api/marketing/projects/{projectId}/site/verify:
 *   post:
 *     tags: [Marketing]
 *     summary: Check site ownership with a DNS record, meta tag or file
 *     description: Team admins only. Rate limited to 10 checks per hour per site.
 *     operationId: verifyMarketingSite
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method: { type: string, enum: [dns, meta, file] }
 *     responses:
 *       200: { description: Updated site; `site.verified` tells whether the check passed }
 *       403: { description: Team admin required, or Marketing is off }
 *       404: { description: No site added yet }
 *       429: { description: Too many verification attempts }
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { marketingSite } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { findMarketingSite, requireRouteParam, serializeSiteWithVerification } from '~/server/utils/marketing-site'
import { checkVerification } from '~/server/services/marketing/site-verification'

const bodySchema = z.object({ method: z.enum(['dns', 'meta', 'file']) })

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const site = await findMarketingSite(projectId)
  if (!site) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Add your site before verifying it'),
    })
  }

  await requireRateLimit(event, {
    maxRequests: 10,
    windowSeconds: 3600,
    identifier: 'marketing-site-verify',
    subject: site.id,
  })

  const result = await checkVerification(site.origin, site.verificationToken, body.method)
  const now = new Date()
  const [updated] = await db
    .update(marketingSite)
    .set(
      result.verified
        ? { verifiedAt: now, verificationMethod: body.method, lastVerificationError: null, updatedAt: now }
        : { lastVerificationError: result.detail, updatedAt: now }
    )
    .where(eq(marketingSite.id, site.id))
    .returning()

  return createSuccessResponse(serializeSiteWithVerification(updated, true), result.detail)
})
