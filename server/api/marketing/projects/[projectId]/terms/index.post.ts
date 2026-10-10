/**
 * @openapi
 * /api/marketing/projects/{projectId}/terms:
 *   post:
 *     tags: [Marketing]
 *     summary: Add a brand, competitor or keyword term
 *     description: >
 *       Any team member with Marketing access. At most 50 terms per site and 10
 *       aliases per term. `competitorDomain` is only allowed on competitors.
 *     operationId: createMarketingTerm
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
 *             required: [kind, label]
 *             properties:
 *               kind: { type: string, enum: [brand, competitor, keyword] }
 *               label: { type: string, minLength: 2, maxLength: 80 }
 *               aliases: { type: array, maxItems: 10, items: { type: string } }
 *               competitorDomain: { type: string, nullable: true }
 *     responses:
 *       200: { description: Term created }
 *       400: { description: Validation failed or the 50 term limit is reached }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: No site added yet }
 */
import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingTerm } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  cleanAliases,
  createTermSchema,
  MAX_TERMS_PER_SITE,
  requireMarketingSite,
  resolveCompetitorDomain,
  serializeTerm,
} from '~/server/utils/marketing-terms'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, createTermSchema)
  const site = await requireMarketingSite(projectId)

  const [{ total }] = await db.select({ total: count() }).from(marketingTerm).where(eq(marketingTerm.siteId, site.id))
  if (total >= MAX_TERMS_PER_SITE) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `A site can have at most ${MAX_TERMS_PER_SITE} terms`),
    })
  }

  const [row] = await db
    .insert(marketingTerm)
    .values({
      id: randomUUID(),
      siteId: site.id,
      kind: body.kind,
      label: body.label,
      aliases: cleanAliases(body.label, body.aliases),
      competitorDomain: resolveCompetitorDomain(body.kind, body.competitorDomain),
      createdAt: new Date(),
    })
    .returning()

  return createSuccessResponse({ term: serializeTerm(row) })
})
