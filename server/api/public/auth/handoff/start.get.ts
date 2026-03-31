import { getCookies } from 'better-auth/cookies'
import { getCookie } from 'h3'
import { z } from 'zod'
import { normalizeHostname } from '~/lib/auth-redirect'
import { auth } from '~/lib/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createPublicAuthHandoffToken, PUBLIC_AUTH_HANDOFF_QUERY_PARAM } from '~/server/utils/public-auth-handoff'
import { resolveAllowedPublicRedirectTarget } from '~/server/utils/public-auth-redirect'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  target: z.string().trim().min(1).max(3000),
})

export default defineEventHandler(async (event) => {
  const query = validateQuery(event, querySchema)
  const redirectTarget = await resolveAllowedPublicRedirectTarget(event, query.target)

  if (!redirectTarget) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid redirect target',
    })
  }

  const session = await requireAuth(event)
  const cookies = getCookies(auth.options)
  const dontRememberMe = Boolean(getCookie(event, cookies.dontRememberToken.name))
  const token = await createPublicAuthHandoffToken({
    dontRememberMe,
    sessionToken: session.session.token,
    targetHost: normalizeHostname(redirectTarget.hostname),
  })

  redirectTarget.searchParams.set(PUBLIC_AUTH_HANDOFF_QUERY_PARAM, token)

  return sendRedirect(event, redirectTarget.toString())
})
