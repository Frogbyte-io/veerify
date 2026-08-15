/**
 * @openapi
 * /api/support/inboxes:
 *   get:
 *     tags: [Support]
 *     summary: List inboxes for a team
 *     operationId: listSupportInboxes
 *     parameters:
 *       - in: query
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Inbox list }
 *       403: { description: Not a member of the team }
 */
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox } from '~/server/database/schema/support'

const querySchema = z.object({
  teamId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireTeamMembership(query.teamId, session.user.id)

  // A team's inboxes are a short, fully-loaded settings list, not an
  // open-ended feed - unlike contacts/companies, this does not paginate.
  const inboxes = await db
    .select()
    .from(supportInbox)
    .where(eq(supportInbox.teamId, query.teamId))
    .orderBy(asc(supportInbox.createdAt))

  return createSuccessResponse({ inboxes })
})
