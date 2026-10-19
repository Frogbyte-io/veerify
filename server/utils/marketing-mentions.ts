import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingSite } from '~/server/database/schema/marketing'
import { createErrorResponse, ErrorCode } from './response'

/** The product's marketing site, or null before one has been created. */
export async function findMentionsSite(projectId: string) {
  const [site] = await db
    .select({ id: marketingSite.id, verifiedAt: marketingSite.verifiedAt })
    .from(marketingSite)
    .where(eq(marketingSite.projectId, projectId))
    .limit(1)
  return site ?? null
}

/** Like `findMentionsSite` but 404s: mutating endpoints have nothing to act on without a site. */
export async function requireMentionsSite(projectId: string) {
  const site = await findMentionsSite(projectId)
  if (!site) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Marketing site not found'),
    })
  }
  return site
}

export function requireRouterParam(event: Parameters<typeof getRouterParam>[0], name: string, label: string): string {
  const value = getRouterParam(event, name)
  if (!value) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `${label} is required`),
    })
  }
  return value
}
