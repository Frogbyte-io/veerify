import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { setActiveOrganizationForSession } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const setActiveOrganizationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // Last-used team hint; ignored unless it is one of the user's teams in that organization.
  teamId: z.string().min(1).nullish(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, setActiveOrganizationSchema)

  const activeTeam = await setActiveOrganizationForSession({
    sessionToken: session.session.token,
    userId: session.user.id,
    organizationId: body.organizationId,
    preferredTeamId: body.teamId ?? null,
  })

  return createSuccessResponse(activeTeam)
})
