import { eq } from 'drizzle-orm'
import { db } from '../database/drizzle'
import { githubIntegration } from '../database/schema/feedback'

type GithubIntegrationUpdateClient = Pick<typeof db, 'update'>

export function hasGithubIntegrationAccessToken(params: {
  persistedAccessToken?: string | null
  oauthToken?: string | null
}) {
  return Boolean(params.oauthToken || params.persistedAccessToken)
}

export async function persistGithubIntegrationAccessToken(
  projectId: string,
  accessToken: string,
  updatedAt: Date = new Date(),
  database: GithubIntegrationUpdateClient = db
) {
  if (!projectId || !accessToken) {
    return false
  }

  const updated = await database
    .update(githubIntegration)
    .set({
      accessToken,
      updatedAt,
    })
    .where(eq(githubIntegration.projectId, projectId))
    .returning({ id: githubIntegration.id })

  return updated.length > 0
}
