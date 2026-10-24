/**
 * Visibility scope for feedback listings that accept caller-supplied project ids
 * (`GET /api/feedback`, `GET /api/feedback/export`).
 *
 * - Project members (see `hasProjectAccess`) see every item of the project,
 *   including hidden ones and private products.
 * - Everybody else (anonymous callers, or signed-in users who are not members)
 *   only sees non-hidden items of PUBLIC products of PUBLIC projects.
 * - A project that is neither accessible nor public is a 403 (404 when it does not exist),
 *   so callers can never read feedback by guessing ids.
 */
import { and, eq, inArray, or, type SQL } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { feedback, product, project } from '~/server/database/schema/feedback'
import { createErrorResponse, ErrorCode } from './response'
import { requirePublicProject, resolveProjectRole } from './project-access'

export interface FeedbackListScope {
  /** SQL condition restricting `feedback` rows to what the caller may see */
  condition: SQL
  /** Projects the caller is a member of (full visibility) */
  memberProjectIds: Set<string>
}

function fail(statusCode: 403 | 404, message: string): never {
  throw createError({
    statusCode,
    statusMessage: statusCode === 403 ? 'Forbidden' : 'Not Found',
    data: createErrorResponse(statusCode === 403 ? ErrorCode.FORBIDDEN : ErrorCode.NOT_FOUND, message),
  })
}

export async function resolveFeedbackListScope(
  requestedProjectIds: string[],
  userId: string | null,
  options: { membersOnly?: boolean } = {}
): Promise<FeedbackListScope> {
  const ids = [...new Set(requestedProjectIds)]
  if (ids.length === 0) fail(404, 'Project not found')

  const projects = await db.select().from(project).where(inArray(project.id, ids))
  if (projects.length !== ids.length) fail(404, 'Project not found')

  const memberProjectIds = new Set<string>()
  const publicProjectIds: string[] = []
  for (const proj of projects) {
    const role = userId ? await resolveProjectRole(proj, userId) : null
    if (role) memberProjectIds.add(proj.id)
    else if (!options.membersOnly && proj.isPublic) publicProjectIds.push(proj.id)
    else fail(403, 'You do not have access to this project')
  }

  const branches: SQL[] = []
  if (memberProjectIds.size > 0) branches.push(inArray(feedback.projectId, [...memberProjectIds]))

  if (publicProjectIds.length > 0) {
    const publicProducts = await db
      .select({ id: product.id })
      .from(product)
      .where(and(inArray(product.projectId, publicProjectIds), eq(product.isPublic, true)))
    if (publicProducts.length > 0) {
      branches.push(
        and(
          inArray(feedback.projectId, publicProjectIds),
          eq(feedback.isHidden, false),
          inArray(
            feedback.productId,
            publicProducts.map((p) => p.id)
          )
        )!
      )
    }
  }

  // No visible branch (e.g. only private products): match nothing.
  const condition = branches.length > 0 ? or(...branches)! : eq(feedback.id, '')
  return { condition, memberProjectIds }
}

/**
 * Gate for non-members reading or interacting with a single feedback item:
 * the project must be public, the item's product must be public (private
 * products answer 404 so they are not revealed), and hidden items are only
 * visible to their author (`allowHidden`).
 */
export async function requirePublicFeedback(
  fb: { projectId: string; productId: string; isHidden: boolean },
  options: { allowHidden?: boolean } = {}
) {
  const proj = await requirePublicProject(fb.projectId)
  const [prod] = await db
    .select({ isPublic: product.isPublic })
    .from(product)
    .where(and(eq(product.id, fb.productId), eq(product.projectId, fb.projectId)))
    .limit(1)
  if (!prod?.isPublic || (fb.isHidden && !options.allowHidden)) fail(404, 'Feedback not found')
  return proj
}
