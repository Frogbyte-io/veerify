/**
 * @openapi
 * /api/marketing/projects/{projectId}/announcements:
 *   get:
 *     tags: [Marketing]
 *     summary: Published changelog entries with their announcement drafts
 *     description: >
 *       Published entries of the product, newest first, each with its drafts per channel
 *       (entries without drafts included). Also reports whether the changelog is on and
 *       whether the team has a usable LLM key.
 *     operationId: listMarketingAnnouncements
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Entries with drafts and a next cursor }
 *       400: { description: Invalid cursor }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Project not found }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { listAnnouncements } from '~/server/services/marketing/announcements/service'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project, teamId } = await requireMarketingAccess(projectId, session.user.id)

  const cursor = getQuery(event).cursor
  return createSuccessResponse(await listAnnouncements(project, teamId, typeof cursor === 'string' ? cursor : null))
})
