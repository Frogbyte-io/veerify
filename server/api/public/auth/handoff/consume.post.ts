import { getRequestURL } from 'h3'
import { z } from 'zod'
import { normalizeHostname } from '~/lib/auth-redirect'
import { createSuccessResponse } from '~/server/utils/response'
import {
  findPublicAuthSession,
  parsePublicAuthHandoffToken,
  setPublicAuthSessionCookies,
} from '~/server/utils/public-auth-handoff'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({
  token: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const body = await validateBody(event, bodySchema)
  const currentHost = normalizeHostname(getRequestURL(event).hostname)
  const handoff = await parsePublicAuthHandoffToken(body.token)

  if (handoff.targetHost !== currentHost) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }

  const authSession = await findPublicAuthSession(handoff.sessionToken)
  if (!authSession) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  await setPublicAuthSessionCookies(event, {
    dontRememberMe: handoff.dontRememberMe,
    session: authSession.session,
  })

  return createSuccessResponse({
    session: {
      id: authSession.session.id,
      expiresAt: authSession.session.expiresAt,
    },
    user: {
      id: authSession.user.id,
      email: authSession.user.email,
      name: authSession.user.name,
      image: authSession.user.image || null,
      emailVerified: authSession.user.emailVerified,
    },
  })
})
