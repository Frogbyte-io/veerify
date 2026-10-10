/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions/bulk:
 *   post:
 *     tags: [Marketing]
 *     summary: Change the triage status of several mentions
 *     description: Ids that do not belong to the product's site are ignored.
 *     operationId: bulkUpdateMarketingMentions
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
 *             required: [ids, status]
 *             properties:
 *               ids: { type: array, minItems: 1, maxItems: 100, items: { type: string } }
 *               status: { type: string, enum: [new, seen, dismissed] }
 *     responses:
 *       200: { description: Number of mentions updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a team member, or Marketing is not enabled }
 */
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { mention } from '~/server/database/schema/marketing'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(100),
  status: z.enum(['new', 'seen', 'dismissed']),
})

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const site = await findMarketingSite(projectId)
  if (!site) return createSuccessResponse({ updated: 0 })

  const updated = await db
    .update(mention)
    .set({ status: body.status })
    .where(and(eq(mention.siteId, site.id), inArray(mention.id, [...new Set(body.ids)])))
    .returning({ id: mention.id })

  return createSuccessResponse({ updated: updated.length })
})
