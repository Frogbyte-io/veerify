/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}/commit:
 *   post:
 *     tags: [Imports]
 *     summary: Commit an import run
 *     description: "Applies a draft run. Runs with up to 500 records are applied before the response (200 with the
 *       completed run); larger runs return 202 with the run still committing, and a scheduled task finishes them
 *       (poll the run for progress). Re-committing the same records creates nothing; fields edited in Veerify are
 *       kept. No notifications, emails or changelog publish hooks are triggered."
 *     operationId: commitImportRun
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
 *       200: { description: "The run, completed (or failed, with error)" }
 *       202: { description: "The run, still committing in the background" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 *       409: { description: "Run is not a draft" }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { getImportRunForProject } from '~/server/services/imports/runs'
import { commitImportRun } from '~/server/services/imports/committer'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')
  const result = await commitImportRun(run.id)
  setResponseStatus(event, result.status === 'committing' ? 202 : 200)
  return createSuccessResponse(result)
})
