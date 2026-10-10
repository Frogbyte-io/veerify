/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/watches:
 *   post:
 *     tags: [Marketing]
 *     summary: Watch a public competitor page for changes
 *     description: >
 *       Marketing admin only. https pages only; the host cannot be the product's own site and
 *       must match the competitor's domain when one is set. At most 3 pages per competitor and
 *       15 per site. The page is fetched at most once a day as VeerifyBot, and robots.txt is respected.
 *     operationId: createMarketingCompetitorWatch
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
 *             required: [termId, url, kind]
 *             properties:
 *               termId: { type: string }
 *               url: { type: string }
 *               kind: { type: string, enum: [pricing, changelog, homepage, other] }
 *     responses:
 *       200: { description: Watch created }
 *       400: { description: Validation failed or a limit is reached }
 *       403: { description: Not a marketing admin, or Marketing is off }
 *       404: { description: Site or competitor not found }
 *       409: { description: This page is already watched }
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorWatch, marketingTerm } from '~/server/database/schema/marketing'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import {
  badRequest,
  createWatchSchema,
  MAX_WATCHES_PER_COMPETITOR,
  MAX_WATCHES_PER_SITE,
  serializeWatch,
  validateWatchUrl,
} from '~/server/utils/marketing-competitors'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, createWatchSchema)
  const site = await requireMarketingSite(projectId)

  // The term must be a competitor of this site; a term id from another product reads as 404.
  const [term] = await db
    .select()
    .from(marketingTerm)
    .where(
      and(eq(marketingTerm.id, body.termId), eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'competitor'))
    )
    .limit(1)
  if (!term) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Competitor not found'),
    })
  }

  const url = validateWatchUrl(body.url, site.origin, term.competitorDomain)

  const [counts] = await db
    .select({
      site: sql<number>`count(*)::int`,
      term: sql<number>`count(*) filter (where ${competitorWatch.termId} = ${term.id})::int`,
    })
    .from(competitorWatch)
    .where(eq(competitorWatch.siteId, site.id))
  if ((counts?.term ?? 0) >= MAX_WATCHES_PER_COMPETITOR) {
    badRequest(`A competitor can have at most ${MAX_WATCHES_PER_COMPETITOR} watched pages`)
  }
  if ((counts?.site ?? 0) >= MAX_WATCHES_PER_SITE) {
    badRequest(`A product can have at most ${MAX_WATCHES_PER_SITE} watched pages`)
  }

  const now = new Date()
  const inserted = await db
    .insert(competitorWatch)
    .values({
      id: randomUUID(),
      siteId: site.id,
      termId: term.id,
      url,
      kind: body.kind,
      createdByUserId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
  if (inserted.length === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This page is already watched'),
    })
  }

  return createSuccessResponse({ watch: serializeWatch(inserted[0]) })
})
