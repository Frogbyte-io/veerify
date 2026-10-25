/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries:
 *   get:
 *     tags: [Changelog]
 *     summary: List changelog entries of a project
 *     operationId: listChangelogEntries
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, published] }
 *       - in: query
 *         name: productId
 *         description: Only entries tagged with this product, or untagged (whole project)
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Entries, newest first, with `nextCursor` }
 *       403: { description: No access to this project, or Changelog is off }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { listEntries, loadEntryProductIds, serializeEntry } from '~/server/services/changelog/entries'
import { listQuerySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireChangelogAccess(projectId, session.user.id)
  const query = validateQuery(event, listQuerySchema)

  const { entries, nextCursor } = await listEntries(projectId, query)
  // The list omits the (up to 50k) body; the editor loads it per entry
  const productIds = await loadEntryProductIds(entries.map((row) => row.id))
  return createSuccessResponse({
    entries: entries.map((row) => ({ ...serializeEntry(row, productIds.get(row.id) ?? []), body: undefined })),
    nextCursor,
  })
})
