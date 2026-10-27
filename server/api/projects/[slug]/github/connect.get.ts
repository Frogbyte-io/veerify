/**
 * @openapi
 * /api/projects/{slug}/github/connect:
 *   get:
 *     tags: [Projects]
 *     summary: Start GitHub OAuth
 *     description: >
 *       Returns the GitHub OAuth authorization URL for connecting a repository. The flow completes in a browser (state and token cookies), so it is only useful interactively; API key callers should send `accessToken` to PUT /api/projects/{slug}/github instead. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: startProjectGithubOAuth
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ authorizationUrl }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 *       500: { description: "GitHub OAuth is not configured" }
 */
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { resolveGithubIntegrationCallbackUrl } from '~/server/utils/github-oauth'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event, { admin: true })

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
