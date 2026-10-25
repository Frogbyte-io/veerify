/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries:
 *   post:
 *     tags: [Changelog]
 *     summary: Create a draft changelog entry
 *     description: The slug is generated from the title and is unique within the project.
 *     operationId: createChangelogEntry
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
 *             required: [title]
 *             properties:
 *               title: { type: string, maxLength: 200 }
 *               summary: { type: string, maxLength: 280, nullable: true }
 *               body: { type: string, maxLength: 50000 }
 *               labels: { type: array, items: { type: string, enum: [new, improved, fixed] } }
 *               feedbackIds: { type: array, maxItems: 50, items: { type: string } }
 *               productIds: { type: array, maxItems: 50, items: { type: string }, description: Empty = whole project }
 *     responses:
 *       200: { description: Entry created }
 *       400: { description: Validation failed, or feedback or products from another project }
 *       403: { description: No access to this project, or Changelog is off }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getEntryProductIds, createEntry, getLinkedFeedback, serializeEntry } from '~/server/services/changelog/entries'
import { createEntrySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireChangelogAccess(projectId, session.user.id)
  const body = await validateBody(event, createEntrySchema)

  const row = await createEntry(projectId, session.user.id, body)
  // Same shape as GET .../entries/{entryId}
  const linked = await getLinkedFeedback(row.id)
  return createSuccessResponse({ ...serializeEntry(row, await getEntryProductIds(row.id)), feedback: linked })
})
