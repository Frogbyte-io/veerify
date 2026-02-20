import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

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
