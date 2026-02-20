import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.projectId, project.id))
    .limit(1)

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
    hasAccessToken: Boolean(integration.accessToken),
    updatedAt: integration.updatedAt,
  })
})
