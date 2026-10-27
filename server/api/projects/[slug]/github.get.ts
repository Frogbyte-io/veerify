/**
 * @openapi
 * /api/projects/{slug}/github:
 *   get:
 *     tags: [Projects]
 *     summary: Get GitHub integration
 *     description: >
 *       Returns the project's GitHub integration settings, or null when none is connected. The access token is never returned, only `hasAccessToken`. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getProjectGithubIntegration
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
 *       200: { description: "Integration summary or null" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { hasGithubIntegrationAccessToken } from '~/server/utils/github-integration'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.projectId, project.id))
    .limit(1)

  const oauthToken = getCookie(event, 'veerify_github_oauth_token')

  if (!integration) {
    return createSuccessResponse(null)
  }

  return createSuccessResponse({
    id: integration.id,
    owner: integration.owner,
    repo: integration.repo,
    repoFullName: `${integration.owner}/${integration.repo}`,
    syncEnabled: integration.syncEnabled,
    autoCreateIssues: integration.autoCreateIssues,
    autoSyncStatus: integration.autoSyncStatus,
    hasAccessToken: hasGithubIntegrationAccessToken({
      persistedAccessToken: integration.accessToken,
      oauthToken,
    }),
    updatedAt: integration.updatedAt,
  })
})
