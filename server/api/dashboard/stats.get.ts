import { requireAuthWithResolvedProject } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { getWorkspaceStatsForProject } from '~/server/utils/dashboard-bootstrap'

export default defineEventHandler(async (event) => {
  const { activeProject } = await requireAuthWithResolvedProject(event)
  const stats = await getWorkspaceStatsForProject(activeProject.id)

  return createSuccessResponse(stats)
})
