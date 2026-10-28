/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}/preview:
 *   get:
 *     tags: [Imports]
 *     summary: Preview an import run
 *     description: "Dry run of the staged records. Counts per section (create, update, unchanged, skip), fields kept
 *       because they were edited in Veerify (first 200), statuses and categories to create, and issues (first 500,
 *       staged issues first). Writes nothing."
 *     operationId: previewImportRun
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
 *     responses:
 *       200: { description: "The import plan" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { getImportRunForProject } from '~/server/services/imports/runs'
import { planImport } from '~/server/services/imports/planner'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')
  return createSuccessResponse(await planImport(run.id))
})
