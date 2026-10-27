/**
 * @openapi
 * /api/projects/{slug}/imports/{runId}:
 *   get:
 *     tags: [Imports]
 *     summary: Get an import run
 *     description: "Run status and summary plus its first 200 issues."
 *     operationId: getImportRun
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
 *       200: { description: "The run and its issues" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or run not found" }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { getImportRunForProject, listImportIssues } from '~/server/services/imports/runs'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const run = await getImportRunForProject(project.id, getRouterParam(event, 'runId') ?? '')
  const issues = await listImportIssues(run.id, 200)
  return createSuccessResponse({ run, issues })
})
