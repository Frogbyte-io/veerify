/**
 * @openapi
 * /api/marketing/projects/{projectId}/terms/{termId}:
 *   put:
 *     tags: [Marketing]
 *     summary: Update a term's name, aliases or competitor domain
 *     operationId: updateMarketingTerm
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: termId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label]
 *             properties:
 *               label: { type: string, minLength: 2, maxLength: 80 }
 *               aliases: { type: array, maxItems: 10, items: { type: string } }
 *               competitorDomain: { type: string, nullable: true }
 *     responses:
 *       200: { description: Term updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Term or site not found }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingTerm } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  cleanAliases,
  requireMarketingSite,
  resolveCompetitorDomain,
  serializeTerm,
  updateTermSchema,
} from '~/server/utils/marketing-terms'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const termId = requireRouteParam(event, 'termId')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, updateTermSchema)
  const site = await requireMarketingSite(projectId)

  const [current] = await db
    .select()
    .from(marketingTerm)
    .where(and(eq(marketingTerm.id, termId), eq(marketingTerm.siteId, site.id)))
    .limit(1)
  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Term not found'),
    })
  }

  // Omitting competitorDomain leaves it as is; null or '' clears it
  const competitorDomain =
    body.competitorDomain === undefined
      ? current.competitorDomain
      : resolveCompetitorDomain(current.kind, body.competitorDomain)

  const [row] = await db
    .update(marketingTerm)
    .set({ label: body.label, aliases: cleanAliases(body.label, body.aliases), competitorDomain })
    .where(eq(marketingTerm.id, current.id))
    .returning()

  return createSuccessResponse({ term: serializeTerm(row) })
})
