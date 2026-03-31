import { optionalAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)

  return createSuccessResponse({
    session: session
      ? {
          id: session.session.id,
          expiresAt: session.session.expiresAt,
          activeOrganizationId: session.session.activeOrganizationId || null,
          activeTeamId: session.session.activeTeamId || null,
        }
      : null,
    user: session
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image || null,
          emailVerified: session.user.emailVerified,
        }
      : null,
  })
})
