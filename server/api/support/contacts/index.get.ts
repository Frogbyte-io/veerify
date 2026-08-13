/**
 * @openapi
 * /api/support/contacts:
 *   get:
 *     tags: [Support]
 *     summary: List contacts for a team
 *     operationId: listSupportContacts
 *     parameters:
 *       - in: query
 *         name: teamId
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
 *       200: { description: Contacts page }
 *       403: { description: Not a member of the team }
 */
import { z } from 'zod'
import { and, desc, eq, ilike, isNull, lt, or } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contact } from '~/server/database/schema/support'

const querySchema = z.object({
  teamId: z.string().min(1),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = querySchema.parse(getQuery(event))

  await requireTeamMembership(query.teamId, session.user.id)

  const conditions = [
    eq(contact.teamId, query.teamId),
    // Merged contacts are tombstones kept so stale references still resolve.
    // They must not appear in the list, or an agent sees the same person twice.
    isNull(contact.mergedIntoContactId),
  ]

  if (query.search) {
    const pattern = `%${query.search}%`
    conditions.push(or(ilike(contact.name, pattern), ilike(contact.email, pattern))!)
  }

  if (query.cursor) {
    conditions.push(lt(contact.createdAt, new Date(query.cursor)))
  }

  const rows = await db
    .select()
    .from(contact)
    .where(and(...conditions))
    .orderBy(desc(contact.createdAt))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows

  return createSuccessResponse({
    contacts: items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  })
})
