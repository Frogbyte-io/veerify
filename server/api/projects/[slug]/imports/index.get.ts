/**
 * @openapi
 * /api/projects/{slug}/imports:
 *   get:
 *     tags: [Imports]
 *     summary: List import runs
 *     description: "The project's 50 most recent import runs, newest first."
 *     operationId: listImportRuns
 *     security: [{ cookieAuth: [] }, { userApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Runs" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project not found" }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { listImportRuns } from '~/server/services/imports/runs'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  return createSuccessResponse(await listImportRuns(project.id, 50))
})
