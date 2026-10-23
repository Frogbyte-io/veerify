/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions:
 *   get:
 *     tags: [Marketing]
 *     summary: List mentions for a product
 *     description: >
 *       Cursor-paginated, newest published first. Also returns counts by status
 *       (with the kind and source filters applied, over the last 180 days) and whether the site is
 *       verified and has terms configured. `canEscalate` is true when Support is on and the
 *       caller can work in a support inbox; escalated items carry `conversationId` and
 *       `conversationInboxId` only when the caller can open that inbox (otherwise both are null).
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
import { and, count, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { conversation } from '~/server/database/schema/support'
import { marketingTerm, mention } from '~/server/database/schema/marketing'
import { accessibleInboxIds, canEscalateMentions } from '~/server/services/marketing/mentions/escalation'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { findMentionsSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'

// Matches the poller's retention window: older rows are deleted anyway, so counting them is wasted work.
const COUNT_WINDOW_MS = 180 * 24 * 60 * 60 * 1000

const querySchema = z.object({
  status: z.enum(['new', 'seen', 'dismissed', 'escalated']).optional(),
  kind: z.enum(['mention', 'competitor', 'opportunity']).optional(),
  source: z.enum(['hackernews', 'reddit', 'bluesky']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)

  const query = validateQuery(event, querySchema)
  const cursor = query.cursor ? decodeListCursor(query.cursor, 'mention') : null

  const counts = { new: 0, seen: 0, dismissed: 0, escalated: 0 }
  const canEscalate = await canEscalateMentions(projectId, session.user.id)
  const site = await findMentionsSite(projectId)
  if (!site) {
    return createSuccessResponse({
      items: [],
      nextCursor: null,
      counts,
      canEscalate,
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
        conversationId: mention.conversationId,
        conversationInboxId: conversation.inboxId,
      })
      .from(mention)
      .leftJoin(marketingTerm, eq(marketingTerm.id, mention.termId))
      .leftJoin(conversation, eq(conversation.id, mention.conversationId))
      .where(and(...listConditions))
      .orderBy(desc(mention.publishedAt), desc(mention.id))
      .limit(query.limit + 1),
    db
      .select({ status: mention.status, total: count() })
      .from(mention)
      .where(and(...scope, gte(mention.publishedAt, new Date(Date.now() - COUNT_WINDOW_MS))))
      .groupBy(mention.status),
    db.select({ total: count() }).from(marketingTerm).where(eq(marketingTerm.siteId, site.id)),
  ])

  for (const row of statusRows) counts[row.status] = Number(row.total)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  const last = items[items.length - 1]

  const reachable = await accessibleInboxIds(
    items.flatMap((row) => (row.conversationInboxId ? [row.conversationInboxId] : [])),
    session.user.id
  )
  const visibleItems = items.map((row) =>
    row.conversationInboxId && reachable.has(row.conversationInboxId)
      ? row
      : { ...row, conversationId: null, conversationInboxId: null }
  )

  return createSuccessResponse({
    items: visibleItems,
    nextCursor: hasMore && last ? encodeListCursor({ createdAt: last.publishedAt, id: last.id }) : null,
    counts,
    canEscalate,
    site: { exists: true, verified: site.verifiedAt !== null, termCount: Number(termTotal?.total ?? 0) },
  })
})
