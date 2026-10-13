/**
 * @openapi
 * /api/marketing/projects/{projectId}/terms/{termId}:
 *   put:
 *     tags: [Marketing]
 *     summary: Update a term's name, aliases or competitor domain (changing it on a term with watches needs a marketing admin)
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
 *       403: { description: Not a team member, Marketing is off, or the competitor domain of a term with watched pages is changed by a non-admin }
 *       404: { description: Term or site not found }
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorWatch, marketingTerm } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess, requireMarketingAdmin } from '~/server/utils/marketing-access'
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

  // Watches are tied to the competitor's domain, so changing or clearing it (which pauses them) is an admin action.
  if (competitorDomain !== current.competitorDomain) {
    const [watched] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(competitorWatch)
      .where(eq(competitorWatch.termId, current.id))
    if ((watched?.count ?? 0) > 0) await requireMarketingAdmin(projectId, session.user.id)
  }

  const [row] = await db
    .update(marketingTerm)
    .set({ label: body.label, aliases: cleanAliases(body.label, body.aliases), competitorDomain })
    .where(eq(marketingTerm.id, current.id))
    .returning()

  return createSuccessResponse({ term: serializeTerm(row) })
})
