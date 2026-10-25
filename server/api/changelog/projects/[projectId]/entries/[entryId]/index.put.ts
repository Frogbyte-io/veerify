/**
 * @openapi
 * /api/changelog/projects/{projectId}/entries/{entryId}:
 *   put:
 *     tags: [Changelog]
 *     summary: Update a changelog entry
 *     description: >
 *       Partial update. `feedbackIds` replaces the linked feedback and must all
 *       belong to this product (max 50). The slug never changes.
 *     operationId: updateChangelogEntry
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *       - { in: path, name: entryId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, maxLength: 200 }
 *               summary: { type: string, maxLength: 280, nullable: true }
 *               body: { type: string, maxLength: 50000 }
 *               labels: { type: array, items: { type: string, enum: [new, improved, fixed] } }
 *               feedbackIds: { type: array, maxItems: 50, items: { type: string } }
 *     responses:
 *       200: { description: Entry updated }
 *       400: { description: Validation failed, or feedback from another product }
 *       404: { description: Entry not found }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getEntryProductIds, getLinkedFeedback, serializeEntry, updateEntry } from '~/server/services/changelog/entries'
import { updateEntrySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  await requireChangelogAccess(projectId, session.user.id)
  const body = await validateBody(event, updateEntrySchema)

  const row = await updateEntry(projectId, entryId, body)
  const feedback = await getLinkedFeedback(row.id)
  return createSuccessResponse({ ...serializeEntry(row, await getEntryProductIds(row.id)), feedback })
})
