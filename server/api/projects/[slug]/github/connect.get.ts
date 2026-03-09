import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { resolveGithubIntegrationCallbackUrl } from '~/server/utils/github-oauth'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'GitHub OAuth not configured',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Missing GITHUB_CLIENT_ID configuration'),
    })
  }

  const state = crypto.randomUUID()
  const callbackUrl = resolveGithubIntegrationCallbackUrl(event)

  setCookie(
    event,
    'veerify_github_oauth_state',
    JSON.stringify({
      state,
      projectSlug: project.slug,
      createdAt: Date.now(),
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    }
  )

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
