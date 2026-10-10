/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions:
 *   get:
 *     tags: [Marketing]
 *     summary: List mentions for a product
 *     description: >
 *       Cursor-paginated, newest published first. Also returns counts by status
 *       (with the kind and source filters applied) and whether the site is
 *       verified and has terms configured.
 *     operationId: listMarketingMentions
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, seen, dismissed, escalated] }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [mention, competitor, opportunity] }
 *       - in: query
 *         name: source
 *         schema: { type: string, enum: [hackernews, reddit, bluesky] }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200: { description: Mentions page }
 *       400: { description: Invalid query or cursor }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { and, count, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { marketingTerm, mention } from '~/server/database/schema/marketing'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { findMarketingSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  status: z.enum(['new', 'seen', 'dismissed', 'escalated']).optional(),
  kind: z.enum(['mention', 'competitor', 'opportunity']).optional(),
  source: z.enum(['hackernews', 'reddit', 'bluesky']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)

  const query = validateQuery(event, querySchema)
  const cursor = query.cursor ? decodeListCursor(query.cursor, 'mention') : null

  const counts = { new: 0, seen: 0, dismissed: 0, escalated: 0 }
  const site = await findMarketingSite(projectId)
  if (!site) {
    return createSuccessResponse({
      items: [],
      nextCursor: null,
      counts,
      site: { exists: false, verified: false, termCount: 0 },
    })
  }

  const scope: SQL[] = [eq(mention.siteId, site.id)]
  if (query.kind) scope.push(eq(mention.kind, query.kind))
  if (query.source) scope.push(eq(mention.source, query.source))

  const listConditions = [...scope]
  if (query.status) listConditions.push(eq(mention.status, query.status))
  if (cursor) {
    listConditions.push(
      or(
        lt(mention.publishedAt, cursor.createdAt),
        and(eq(mention.publishedAt, cursor.createdAt), lt(mention.id, cursor.id))
      ) as SQL
    )
  }

  const [rows, statusRows, [termTotal]] = await Promise.all([
    db
      .select({
        id: mention.id,
        source: mention.source,
        kind: mention.kind,
        status: mention.status,
        url: mention.url,
        author: mention.author,
        title: mention.title,
        excerpt: mention.excerpt,
        score: mention.score,
        publishedAt: mention.publishedAt,
        createdAt: mention.createdAt,
        termId: mention.termId,
        termLabel: marketingTerm.label,
      })
      .from(mention)
      .leftJoin(marketingTerm, eq(marketingTerm.id, mention.termId))
      .where(and(...listConditions))
      .orderBy(desc(mention.publishedAt), desc(mention.id))
      .limit(query.limit + 1),
    db
      .select({ status: mention.status, total: count() })
      .from(mention)
      .where(and(...scope))
      .groupBy(mention.status),
    db.select({ total: count() }).from(marketingTerm).where(eq(marketingTerm.siteId, site.id)),
  ])

  for (const row of statusRows) counts[row.status] = Number(row.total)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]

  return createSuccessResponse({
    items,
    nextCursor: hasMore && last ? encodeListCursor({ createdAt: last.publishedAt, id: last.id }) : null,
    counts,
    site: { exists: true, verified: site.verifiedAt !== null, termCount: Number(termTotal?.total ?? 0) },
  })
})
