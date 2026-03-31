import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { getCookies } from 'better-auth/cookies'
import { serializeCookie, serializeSignedCookie } from 'better-call'
import { and, eq, gt } from 'drizzle-orm'
import { appendResponseHeader } from 'h3'
import { z } from 'zod'
import { auth } from '~/lib/auth'
import { normalizeHostname } from '~/lib/auth-redirect'
import { db } from '~/server/database/drizzle'
import { session as authSession, user as authUser } from '~/server/database/schema/auth'

export const PUBLIC_AUTH_HANDOFF_QUERY_PARAM = 'authHandoff'

const PUBLIC_AUTH_HANDOFF_TTL_MS = 90 * 1000

const publicAuthHandoffSchema = z.object({
  sessionToken: z.string().min(1),
  targetHost: z.string().min(1).transform((value) => normalizeHostname(value)),
  dontRememberMe: z.boolean().default(false),
  expiresAt: z.number().int().positive(),
})

export async function createPublicAuthHandoffToken(input: {
  dontRememberMe: boolean
  sessionToken: string
  targetHost: string
}) {
  const authContext = await auth.$context

  return symmetricEncrypt({
    key: authContext.secretConfig,
    data: JSON.stringify({
      sessionToken: input.sessionToken,
      targetHost: normalizeHostname(input.targetHost),
      dontRememberMe: input.dontRememberMe,
      expiresAt: Date.now() + PUBLIC_AUTH_HANDOFF_TTL_MS,
    }),
  })
}

export async function parsePublicAuthHandoffToken(token: string) {
  const authContext = await auth.$context
  const decrypted = await symmetricDecrypt({
    key: authContext.secretConfig,
    data: token,
  })
  const parsed = publicAuthHandoffSchema.parse(JSON.parse(decrypted))

  if (parsed.expiresAt <= Date.now()) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  return parsed
}

export async function findPublicAuthSession(sessionToken: string) {
  const [record] = await db
    .select({
      session: authSession,
      user: authUser,
    })
    .from(authSession)
    .innerJoin(authUser, eq(authSession.userId, authUser.id))
    .where(and(eq(authSession.token, sessionToken), gt(authSession.expiresAt, new Date())))
    .limit(1)

  return record || null
}

function clearCookieDomain<T extends { domain?: string }>(attributes: T): T {
  const nextAttributes = { ...attributes }
  delete nextAttributes.domain
  return nextAttributes
}

export async function setPublicAuthSessionCookies(
  event: Parameters<typeof appendResponseHeader>[0],
  input: {
    dontRememberMe: boolean
    session: NonNullable<Awaited<ReturnType<typeof findPublicAuthSession>>>['session']
  }
) {
  if (!input.session) {
    return
  }

  const authContext = await auth.$context
  const cookies = getCookies(auth.options)
  const expiresInSeconds = Math.max(0, Math.floor((new Date(input.session.expiresAt).getTime() - Date.now()) / 1000))

  const sessionTokenCookie = await serializeSignedCookie(
    cookies.sessionToken.name,
    input.session.token,
    authContext.secret,
    {
      ...clearCookieDomain(cookies.sessionToken.attributes),
      ...(input.dontRememberMe ? { maxAge: undefined } : { maxAge: expiresInSeconds }),
    }
  )
  appendResponseHeader(event, 'set-cookie', sessionTokenCookie)

  if (input.dontRememberMe) {
    const dontRememberCookie = await serializeSignedCookie(
      cookies.dontRememberToken.name,
      'true',
      authContext.secret,
      clearCookieDomain(cookies.dontRememberToken.attributes)
    )
    appendResponseHeader(event, 'set-cookie', dontRememberCookie)
    return
  }

  const clearDontRememberCookie = serializeCookie(cookies.dontRememberToken.name, '', {
    ...clearCookieDomain(cookies.dontRememberToken.attributes),
    maxAge: 0,
  })
  appendResponseHeader(event, 'set-cookie', clearDontRememberCookie)
}
