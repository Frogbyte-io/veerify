/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries/{entryId}/publish:
 *   post:
 *     tags: [Changelog]
 *     summary: Publish a changelog entry
 *     description: >
 *       Idempotent: publishing a published entry changes nothing. Publish hooks
 *       (review requests, announcement drafts) run on the first publish only
 *       and never block it.
 *     operationId: publishChangelogEntry
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *       - { in: path, name: entryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Entry published }
 *       400: { description: Entry has no summary or body }
 *       404: { description: Entry not found }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getLinkedFeedback, publishEntry, serializeEntry } from '~/server/services/changelog/entries'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  await requireChangelogAccess(projectId, session.user.id)

  const row = await publishEntry(projectId, entryId)
  const feedback = await getLinkedFeedback(row.id)
  return createSuccessResponse({ ...serializeEntry(row), feedback })
})
