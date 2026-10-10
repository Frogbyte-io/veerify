/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions/sources:
 *   get:
 *     tags: [Marketing]
 *     summary: Status of each mention source for a product
 *     description: Whether each source is configured on this install, when it was last polled and its last error.
 *     operationId: listMarketingMentionSources
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Source status list }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { mentionSourceCursor } from '~/server/database/schema/marketing'
import { SOCIAL_SOURCES } from '~/server/services/social-sources'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)

  const site = await findMarketingSite(projectId)
  const cursors = site
    ? await db
        .select({
          source: mentionSourceCursor.source,
          lastPolledAt: mentionSourceCursor.lastPolledAt,
          lastError: mentionSourceCursor.lastError,
        })
        .from(mentionSourceCursor)
        .where(eq(mentionSourceCursor.siteId, site.id))
    : []

  return createSuccessResponse({
    sources: SOCIAL_SOURCES.map((source) => {
      const cursor = cursors.find((c) => c.source === source.id)
      return {
        id: source.id,
        label: source.label,
        configured: source.isConfigured(),
        lastPolledAt: cursor?.lastPolledAt ?? null,
        lastError: cursor?.lastError ?? null,
      }
    }),
  })
})
