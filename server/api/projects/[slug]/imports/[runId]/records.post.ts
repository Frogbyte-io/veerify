/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}/records:
 *   post:
 *     tags: [Imports]
 *     summary: Add a batch of records to an import run
 *     description: "At most 1,000 records per batch and 50,000 per run. Send sections only (statuses, categories, people, feedback, comments, changelog); format and target belong to run creation. Duplicate externalIds within a section of the run are dropped and reported as skipped issues."
 *     operationId: addImportRecords
 *     security: [{ cookieAuth: [] }, { userApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               statuses: { type: array, items: { type: object } }
 *               categories: { type: array, items: { type: object } }
 *               people: { type: array, items: { type: object } }
 *               feedback: { type: array, items: { type: object } }
 *               comments: { type: array, items: { type: object } }
 *               changelog: { type: array, items: { type: object } }
 *     responses:
 *       201: { description: "Batch staged; returns seq, recordCount, runRecordCount and issues" }
 *       400: { description: "Validation failed or a record limit was exceeded" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 *       409: { description: "Run is not a draft" }
 */
import { createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { importBatchSchema } from '~/server/services/imports/format'
import { addImportBatch, getImportRunForProject, importHttpError } from '~/server/services/imports/runs'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')

  const raw = await readBody(event)
  if (raw && typeof raw === 'object' && ('format' in raw || 'target' in raw)) {
    importHttpError(
      400,
      'Bad Request',
      ErrorCode.VALIDATION_ERROR,
      'Send format and target to create the run; records batches carry only sections'
    )
  }

  const batch = await validateBody(event, importBatchSchema)
  const result = await addImportBatch(run.id, batch)

  setResponseStatus(event, 201)
  return createSuccessResponse(result)
})
