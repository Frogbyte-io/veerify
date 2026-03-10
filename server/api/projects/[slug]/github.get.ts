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
