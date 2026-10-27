/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}/cancel:
 *   post:
 *     tags: [Imports]
 *     summary: Cancel an import run
 *     description: "Only draft or committing runs can be canceled."
 *     operationId: cancelImportRun
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
 *       200: { description: "The canceled run" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 *       409: { description: "Run is already completed, failed or canceled" }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { cancelImportRun, getImportRunForProject } from '~/server/services/imports/runs'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')
  return createSuccessResponse(await cancelImportRun(run.id))
})
