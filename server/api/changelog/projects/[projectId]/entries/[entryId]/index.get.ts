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
 *       403: { description: No access to this project, or Changelog is off }
 *       404: { description: Entry not found }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getEntryProductIds, findEntry, getLinkedFeedback, serializeEntry } from '~/server/services/changelog/entries'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  await requireChangelogAccess(projectId, session.user.id)

  const row = await findEntry(projectId, entryId)
  const feedback = await getLinkedFeedback(row.id)
  return createSuccessResponse({ ...serializeEntry(row, await getEntryProductIds(row.id)), feedback })
})
