/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries/{entryId}:
 *   delete:
 *     tags: [Changelog]
 *     summary: Delete a changelog entry
 *     operationId: deleteChangelogEntry
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *       - { in: path, name: entryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Entry deleted }
 *       404: { description: Entry not found }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { deleteEntry } from '~/server/services/changelog/entries'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  await requireChangelogAccess(projectId, session.user.id)

  await deleteEntry(projectId, entryId)
  return createSuccessResponse({ deleted: true })
})
