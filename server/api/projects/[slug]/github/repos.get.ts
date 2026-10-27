/**
 * @openapi
 * /api/projects/{slug}/github/repos:
 *   get:
 *     tags: [Projects]
 *     summary: List GitHub repositories
 *     description: >
 *       Lists up to 100 repositories visible to the stored GitHub token (or the temporary OAuth cookie). Returns an empty array when no token is available. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjectGithubRepos
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
 *       200: { description: "Array of { id, fullName, name, htmlUrl, private }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 *       502: { description: "GitHub request failed" }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event, { admin: true })

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.projectId, project.id))
    .limit(1)

  const accessToken = getCookie(event, 'veerify_github_oauth_token') || integration?.accessToken

  if (!accessToken) {
    return createSuccessResponse([])
  }

  const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw createError({
      statusCode: response.status === 401 ? 401 : 502,
      statusMessage: 'Unable to load repositories',
      data: createErrorResponse(
        response.status === 401 ? ErrorCode.UNAUTHORIZED : ErrorCode.INTERNAL_ERROR,
        response.status === 401
          ? 'GitHub authorization expired. Please reconnect.'
          : 'Failed to fetch repositories from GitHub'
      ),
    })
  }

  const repos = (await response.json()) as Array<{
    id: number
    full_name: string
    name: string
    html_url: string
    private: boolean
  }>

  return createSuccessResponse(
    repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      htmlUrl: repo.html_url,
      private: repo.private,
    }))
  )
})
