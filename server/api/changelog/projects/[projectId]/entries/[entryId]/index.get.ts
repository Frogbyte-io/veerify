/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries/{entryId}:
 *   get:
 *     tags: [Changelog]
 *     summary: Get a changelog entry with its linked feedback
 *     operationId: getChangelogEntry
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *       - { in: path, name: entryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "Entry with linked `feedback` (id, title, status)" }
 *       403: { description: Not a team member, or Changelog is off }
 *       404: { description: Entry not found }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { findEntry, getLinkedFeedback, serializeEntry } from '~/server/services/changelog/entries'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  await requireChangelogAccess(projectId, session.user.id)

  const row = await findEntry(projectId, entryId)
  const feedback = await getLinkedFeedback(row.id)
  return createSuccessResponse({ ...serializeEntry(row), feedback })
})
