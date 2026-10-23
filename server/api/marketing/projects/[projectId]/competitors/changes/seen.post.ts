/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/changes/seen:
 *   post:
 *     tags: [Marketing]
 *     summary: Mark competitor changes as seen
 *     description: Any team member with Marketing access. Marks every unseen change when `ids` is omitted.
 *     operationId: markMarketingCompetitorChangesSeen
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, maxItems: 100, items: { type: string } }
 *     responses:
 *       200: { description: Changes marked as seen }
 *       403: { description: Not a team member, or Marketing is off }
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorChange } from '~/server/database/schema/marketing'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { markSeenSchema } from '~/server/utils/marketing-competitors'
import { findMarketingSite, requireRouteParam } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAccess(projectId, session.user.id)
  const raw = await readBody(event).catch(() => null)
  const body = markSeenSchema.safeParse(raw ?? {})
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Validation failed' })
  }

  const site = await findMarketingSite(projectId)
  if (!site) return createSuccessResponse({ updated: 0 })

  // Always scoped to this site, so ids from another product are ignored.
  const conditions = [eq(competitorChange.siteId, site.id), isNull(competitorChange.seenAt)]
  if (body.data.ids) {
    if (body.data.ids.length === 0) return createSuccessResponse({ updated: 0 })
    conditions.push(inArray(competitorChange.id, body.data.ids))
  }
  const updated = await db
    .update(competitorChange)
    .set({ seenAt: new Date() })
    .where(and(...conditions))
    .returning({ id: competitorChange.id })

  return createSuccessResponse({ updated: updated.length })
})
