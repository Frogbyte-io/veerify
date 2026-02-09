import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { activeTeam } = await requireAuthWithResolvedTeam(event)
  return createSuccessResponse(activeTeam)
})
