import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { setActiveTeamAndOrganization } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const setActiveTeamSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, setActiveTeamSchema)

  const activeTeam = await setActiveTeamAndOrganization({
    sessionToken: session.session.token,
    userId: session.user.id,
    teamId: body.teamId,
  })

  return createSuccessResponse(activeTeam)
})
