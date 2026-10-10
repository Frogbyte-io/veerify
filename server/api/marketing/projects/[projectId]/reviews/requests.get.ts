/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/requests:
 *   get:
 *     tags: [Marketing]
 *     summary: List review and testimonial requests
 *     description: Cursor-paginated log, newest first, with status, trigger and whether the customer clicked.
 *     operationId: listMarketingReviewRequests
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200: { description: Requests page }
 *       400: { description: Invalid query or cursor }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { reviewRequest } from '~/server/database/schema/marketing'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)

  const query = validateQuery(event, querySchema)
  const cursor = query.cursor ? decodeListCursor(query.cursor, 'review request') : null

  const conditions: SQL[] = [eq(reviewRequest.projectId, projectId)]
  if (cursor) {
    conditions.push(
      or(
        lt(reviewRequest.createdAt, cursor.createdAt),
        and(eq(reviewRequest.createdAt, cursor.createdAt), lt(reviewRequest.id, cursor.id))
      ) as SQL
    )
  }

  // The token is a bearer secret for the public testimonial page: never returned.
  const rows = await db
    .select({
      id: reviewRequest.id,
      email: reviewRequest.email,
      name: reviewRequest.name,
      trigger: reviewRequest.trigger,
      status: reviewRequest.status,
      skipReason: reviewRequest.skipReason,
      error: reviewRequest.error,
      sentAt: reviewRequest.sentAt,
      clickedAt: reviewRequest.clickedAt,
      createdAt: reviewRequest.createdAt,
    })
    .from(reviewRequest)
    .where(and(...conditions))
    .orderBy(desc(reviewRequest.createdAt), desc(reviewRequest.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]

  return createSuccessResponse({
    items,
    nextCursor: hasMore && last ? encodeListCursor({ createdAt: last.createdAt, id: last.id }) : null,
  })
})
