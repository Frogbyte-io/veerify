/**
 * @openapi
 * /api/marketing/projects/{projectId}/site:
 *   put:
 *     tags: [Marketing]
 *     summary: Add or change the marketing site origin
 *     description: >
 *       Team admins only. Changing the origin resets verification and issues a
 *       new token. A site covered by one of the product's verified custom
 *       domains is verified immediately (method `domain`).
 *     operationId: putMarketingSite
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
 *             required: [origin]
 *             properties:
 *               origin: { type: string, example: example.com }
 *     responses:
 *       200: { description: Site saved }
 *       400: { description: Invalid site address }
 *       403: { description: Team admin required, or Marketing is off }
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { projectDomain } from '~/server/database/schema/feedback'
import { marketingSite } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { findMarketingSite, requireRouteParam, serializeSiteWithVerification } from '~/server/utils/marketing-site'
import {
  generateVerificationToken,
  isCoveredByVerifiedDomain,
  normalizeSiteOrigin,
  SiteOriginError,
} from '~/server/services/marketing/site-verification'

const bodySchema = z.object({ origin: z.string().trim().min(1).max(255) })

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { teamId } = await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  let origin: string
  try {
    origin = normalizeSiteOrigin(body.origin)
  } catch (error) {
    if (error instanceof SiteOriginError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, error.message),
      })
    }
    throw error
  }

  const existing = await findMarketingSite(projectId)
  const originChanged = !existing || existing.origin !== origin
  if (existing && !originChanged && existing.verifiedAt) {
    return createSuccessResponse(serializeSiteWithVerification(existing, true))
  }

  const domains = await db
    .select({ hostname: projectDomain.hostname })
    .from(projectDomain)
    .where(and(eq(projectDomain.projectId, projectId), eq(projectDomain.status, 'active')))
  const covered = isCoveredByVerifiedDomain(
    origin,
    domains.map((d) => d.hostname)
  )

  const now = new Date()
  const verification = covered
    ? { verifiedAt: now, verificationMethod: 'domain' as const, lastVerificationError: null }
    : { verifiedAt: null, verificationMethod: null, lastVerificationError: null }

  let saved
  if (existing) {
    const [row] = await db
      .update(marketingSite)
      .set({
        origin,
        // The token only changes with the origin, so re-saving an unverified site keeps its instructions valid
        ...(originChanged ? { verificationToken: generateVerificationToken() } : {}),
        ...verification,
        updatedAt: now,
      })
      .where(eq(marketingSite.id, existing.id))
      .returning()
    saved = row
  } else {
    const [row] = await db
      .insert(marketingSite)
      .values({
        id: randomUUID(),
        projectId,
        teamId,
        origin,
        verificationToken: generateVerificationToken(),
        ...verification,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    saved = row
  }

  return createSuccessResponse(serializeSiteWithVerification(saved, true))
})
