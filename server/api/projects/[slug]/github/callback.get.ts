import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

interface GithubOAuthStateCookie {
  state: string
  projectSlug: string
  createdAt: number
}

export default defineEventHandler(async (event) => {
  await requireProjectCategoryAccess(event)

  const projectSlug = getRouterParam(event, 'slug')
  const code = getQuery(event).code
  const returnedState = getQuery(event).state

  if (!projectSlug || typeof code !== 'string' || typeof returnedState !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing OAuth callback parameters'),
    })
  }

  const rawStateCookie = getCookie(event, 'veerify_github_oauth_state')
  if (!rawStateCookie) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing OAuth state'),
    })
  }

  let stateCookie: GithubOAuthStateCookie | null = null
  try {
    stateCookie = JSON.parse(rawStateCookie) as GithubOAuthStateCookie
  } catch {
    stateCookie = null
  }

  if (
    !stateCookie ||
    stateCookie.state !== returnedState ||
    stateCookie.projectSlug !== projectSlug ||
    Date.now() - stateCookie.createdAt > 10 * 60 * 1000
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid or expired OAuth state'),
    })
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'GitHub OAuth not configured',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Missing GitHub OAuth configuration'),
    })
  }

  const callbackUrl = `${getRequestURL(event).origin}/api/projects/${projectSlug}/github/callback`
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      state: returnedState,
      redirect_uri: callbackUrl,
    }),
  })

  if (!tokenResponse.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: 'GitHub token exchange failed',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Could not exchange OAuth code with GitHub'),
    })
  }

  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string }
  if (!tokenBody.access_token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'GitHub authorization failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, tokenBody.error || 'GitHub did not return an access token'),
    })
  }

  deleteCookie(event, 'veerify_github_oauth_state', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  setCookie(event, 'veerify_github_oauth_token', tokenBody.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  })

  return sendRedirect(event, `/products/${projectSlug}?githubConnected=1#github`)
})
