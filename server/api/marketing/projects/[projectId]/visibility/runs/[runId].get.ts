/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs/{runId}:
 *   get:
 *     tags: [Marketing]
 *     summary: Get one AI visibility run with progress counts
 *     operationId: getVisibilityRun
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Run and progress }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Run not found for this product }
 */
import { requireSiteRun, requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { EMPTY_PROGRESS, getRunProgress } from '~/server/services/marketing/visibility/progress'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  const run = await requireSiteRun(site.id, getRouterParam(event, 'runId') ?? '')
  const progress = await getRunProgress([run.id])

  return createSuccessResponse({ run: { ...run, progress: progress[run.id] ?? EMPTY_PROGRESS } })
})
