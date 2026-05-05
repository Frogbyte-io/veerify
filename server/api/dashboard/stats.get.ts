import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createSuccessResponse } from '~/server/utils/response'
import { getWorkspaceStatsForTeam } from '~/server/utils/dashboard-bootstrap'

export default defineEventHandler(async (event) => {
  const { activeTeam } = await requireAuthWithResolvedTeam(event)
  const stats = await getWorkspaceStatsForTeam(activeTeam.id)

  return createSuccessResponse(stats)
})
