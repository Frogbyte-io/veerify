/**
 * @openapi
 * /api/support/companies:
 *   get:
 *     tags: [Support]
 *     summary: List companies for a project
 *     operationId: listSupportCompanies
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Companies page }
 *       403: { description: Not a member of the project }
 */
import { z } from 'zod'
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { supportCompany } from '~/server/database/schema/support'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  projectId: z.string().min(1),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireProjectAccess(query.projectId, session.user.id)

  const conditions = [eq(supportCompany.projectId, query.projectId)]

  if (query.search) {
    const pattern = `%${query.search}%`
    conditions.push(or(ilike(supportCompany.name, pattern), ilike(supportCompany.domain, pattern))!)
  }

  if (query.cursor) {
    const cursor = decodeListCursor(query.cursor, 'company')
    conditions.push(
      or(
        lt(supportCompany.createdAt, cursor.createdAt),
        and(eq(supportCompany.createdAt, cursor.createdAt), lt(supportCompany.id, cursor.id))
      )!
    )
  }

  const rows = await db
    .select()
    .from(supportCompany)
    .where(and(...conditions))
    .orderBy(desc(supportCompany.createdAt), desc(supportCompany.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows

  return createSuccessResponse({
    companies: items,
    hasMore,
    nextCursor: hasMore
      ? encodeListCursor({ createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id })
      : null,
  })
})
