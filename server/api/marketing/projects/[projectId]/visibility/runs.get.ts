/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs:
 *   get:
 *     tags: [Marketing]
 *     summary: List the 20 most recent AI visibility runs with progress counts
 *     operationId: listVisibilityRuns
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Recent runs }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Project or marketing site not found }
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityRun } from '~/server/database/schema/marketing'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { EMPTY_PROGRESS, getRunProgress } from '~/server/services/marketing/visibility/progress'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)

  const runs = await db
    .select()
    .from(aiVisibilityRun)
    .where(eq(aiVisibilityRun.siteId, site.id))
    .orderBy(desc(aiVisibilityRun.createdAt), desc(aiVisibilityRun.id))
    .limit(20)

  const progress = await getRunProgress(runs.map((run) => run.id))
  return createSuccessResponse({
    runs: runs.map((run) => ({ ...run, progress: progress[run.id] ?? EMPTY_PROGRESS })),
  })
})
