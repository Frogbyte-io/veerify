import { and, eq, ne, sql } from 'drizzle-orm'
import { createError, getRouterParam, type H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt, aiVisibilityRun, marketingSite } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { MAX_ACTIVE_PROMPTS, MAX_TOTAL_PROMPTS } from './prompts'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

function notFound(message: string): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, message),
  })
}

/**
 * Marketing access for the product plus its marketing site. A product that has
 * not set up a site yet reads as 404 with a message the UI can act on.
 */
export async function requireVisibilitySite(projectId: string, userId: string) {
  const access = await requireMarketingAccess(projectId, userId)
  const [site] = await db.select().from(marketingSite).where(eq(marketingSite.projectId, projectId)).limit(1)
  if (!site) notFound('No marketing site is set up for this product')
  return { ...access, site }
}

/** The run must belong to the site; anything else reads as not found. */
export async function requireSiteRun(siteId: string, runId: string) {
  const [run] = await db
    .select()
    .from(aiVisibilityRun)
    .where(and(eq(aiVisibilityRun.id, runId), eq(aiVisibilityRun.siteId, siteId)))
    .limit(1)
  if (!run) notFound('Run not found')
  return run
}

/** The prompt must belong to the site; anything else reads as not found. */
export async function requireSitePrompt(siteId: string, promptId: string) {
  const [prompt] = await db
    .select()
    .from(aiVisibilityPrompt)
    .where(and(eq(aiVisibilityPrompt.id, promptId), eq(aiVisibilityPrompt.siteId, siteId)))
    .limit(1)
  if (!prompt) notFound('Prompt not found')
  return prompt
}

/** Session + `:projectId` param + marketing access + site, the preamble of every visibility route. */
export async function requireVisibilityRequest(event: H3Event) {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project ID is required'),
    })
  }
  const access = await requireVisibilitySite(projectId, session.user.id)
  return { ...access, userId: session.user.id, projectId }
}

type DbExecutor = Pick<typeof db, 'select'>

/**
 * Runs `fn` in a transaction holding a per-site advisory lock, so prompt cap
 * checks and the following insert/update cannot race with concurrent requests.
 */
export async function withPromptCapLock<T>(
  siteId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`marketing_prompts:${siteId}`}, 0))`)
    return fn(tx)
  })
}

/** Throws 409 when activating another prompt would exceed the per-site cap. */
export async function assertPromptCapacity(siteId: string, excludePromptId?: string, executor: DbExecutor = db) {
  const conditions = [eq(aiVisibilityPrompt.siteId, siteId), eq(aiVisibilityPrompt.active, true)]
  if (excludePromptId) conditions.push(ne(aiVisibilityPrompt.id, excludePromptId))
  const [row] = await executor
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiVisibilityPrompt)
    .where(and(...conditions))
  if ((row?.n ?? 0) >= MAX_ACTIVE_PROMPTS) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, `You can have at most ${MAX_ACTIVE_PROMPTS} active prompts`),
    })
  }
}

/** Throws 409 when the site already holds the maximum number of prompts (active or not). */
export async function assertTotalPromptCapacity(siteId: string, executor: DbExecutor = db) {
  const [row] = await executor
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiVisibilityPrompt)
    .where(eq(aiVisibilityPrompt.siteId, siteId))
  if ((row?.n ?? 0) >= MAX_TOTAL_PROMPTS) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        `You can have at most ${MAX_TOTAL_PROMPTS} prompts. Delete some first`
      ),
    })
  }
}
