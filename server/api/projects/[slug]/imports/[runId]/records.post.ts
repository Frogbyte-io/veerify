/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}/records:
 *   post:
 *     tags: [Imports]
 *     summary: Add a batch of records to an import run
 *     description: "At most 1,000 records per batch, 50,000 per run and a 4 MiB request body. Send sections only (statuses, categories, people, feedback, comments, changelog); format, target, source and sourceLabel are rejected (they belong to run creation). Unknown sections are rejected (400). Duplicate externalIds within a section of the run are dropped and reported as skipped issues."
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
 *       413: { description: "Request body exceeds 4 MiB" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 *       409: { description: "Run is not a draft" }
 */
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { readJsonBodyWithLimit } from '~/server/utils/json-body-limit'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { IMPORT_MAX_BODY_BYTES, importBatchSchema } from '~/server/services/imports/format'
import { addImportBatch, getImportRunForProject, importHttpError } from '~/server/services/imports/runs'

/** Document-level keys: they belong to run creation, never to a records batch. */
const DOCUMENT_KEYS = ['format', 'target', 'source', 'sourceLabel']

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')

  const raw = await readJsonBodyWithLimit(event, IMPORT_MAX_BODY_BYTES)
  if (raw && typeof raw === 'object' && DOCUMENT_KEYS.some((key) => key in raw)) {
    importHttpError(
      400,
      'Bad Request',
      ErrorCode.VALIDATION_ERROR,
      'Send format and target to create the run; records batches carry only sections'
    )
  }
  // An unknown key is usually a misspelt section ("comment"); dropping it would silently lose those records.
  const unknown =
    raw && typeof raw === 'object' ? Object.keys(raw).filter((key) => !(key in importBatchSchema.shape)) : []
  if (unknown.length) {
    importHttpError(
      400,
      'Bad Request',
      ErrorCode.VALIDATION_ERROR,
      `Unknown section ${unknown.map((key) => `"${key}"`).join(', ')}; sections are ${Object.keys(importBatchSchema.shape).join(', ')}`
    )
  }

  const parsed = importBatchSchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', parsed.error.issues),
    })
  }
  const batch = parsed.data
  const result = await addImportBatch(run.id, batch)

  setResponseStatus(event, 201)
  return createSuccessResponse(result)
})
