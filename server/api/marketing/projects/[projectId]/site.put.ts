/**
 * @openapi
 * /api/marketing/projects/{projectId}/site:
 *   put:
 *     tags: [Marketing]
 *     summary: Add or change the marketing site origin
 *     description: >
 *       Project admins only. Changing the origin resets verification and issues a
 *       new token. A site covered by one of the product's verified custom
 *       domains is verified immediately (method `domain`). It also disconnects Search Console (token revoked,
 *       metrics deleted) and deletes SEO audits and competitor watches on the old host; terms, AI visibility
 *       prompts and mentions are brand-level and kept.
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
 *       403: { description: Project admin required, or Marketing is off }
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { projectDomain } from '~/server/database/schema/feedback'
import { marketingSite } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { findMarketingSite, requireRouteParam, serializeSiteWithVerification } from '~/server/utils/marketing-site'
import { resetOriginScopedData } from '~/server/services/marketing/site-origin'
import {
  generateVerificationToken,
  isCoveredByVerifiedDomain,
  normalizeSiteOrigin,
  SiteOriginError,
} from '~/server/services/marketing/site-verification'

const bodySchema = z.object({ origin: z.string().trim().min(1).max(255) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)
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
    ? {
        verifiedAt: now,
        verificationMethod: 'domain' as const,
        verificationCheckedAt: now,
        verificationFailures: 0,
        lastVerificationError: null,
      }
    : {
        verifiedAt: null,
        verificationMethod: null,
        verificationCheckedAt: null,
        verificationFailures: 0,
        lastVerificationError: null,
      }

  // Origin-scoped data must not outlive the origin it describes (see site-origin.ts for the rule)
  if (existing && originChanged) await resetOriginScopedData(existing.id, existing.origin)

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
