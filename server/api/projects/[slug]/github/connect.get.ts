import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  await requireProjectCategoryAccess(event)

  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'GitHub OAuth not configured',
      data: createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'Missing GITHUB_CLIENT_ID configuration'
      ),
    })
  }

  const projectSlug = getRouterParam(event, 'slug')
  if (!projectSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project slug is required'),
    })
  }

  const state = crypto.randomUUID()
  const callbackUrl = `${getRequestURL(event).origin}/api/projects/${projectSlug}/github/callback`

  setCookie(event, 'veerify_github_oauth_state', JSON.stringify({
    state,
    projectSlug,
    createdAt: Date.now(),
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo read:user',
    state,
  })

  return createSuccessResponse({
    authorizationUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
  })
})
