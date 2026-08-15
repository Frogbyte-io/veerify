/**
 * @openapi
 * /api/support/tags:
 *   get:
 *     tags: [Support]
 *     summary: List tags for a team
 *     operationId: listSupportTags
 *     parameters:
 *       - in: query
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag list }
 *       403: { description: Not a member of the team }
 */
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportTag } from '~/server/database/schema/support'

const querySchema = z.object({
  teamId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireTeamMembership(query.teamId, session.user.id)

  // A team's tag vocabulary is a short controlled list, not a feed - no
  // pagination, same reasoning as the inbox address/member list endpoints.
  const tags = await db
    .select()
    .from(supportTag)
    .where(eq(supportTag.teamId, query.teamId))
    .orderBy(asc(supportTag.name))

  return createSuccessResponse({ tags })
})
