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
import { and, asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import {
  capabilitiesForRole,
  parseSupportInboxRole,
  requireTeamMembership,
  type SupportInboxRole,
} from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxMember } from '~/server/database/schema/support'

const querySchema = z.object({
  teamId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  const teamMembership = await requireTeamMembership(query.teamId, session.user.id)

  // A team's inboxes are a short, fully-loaded settings list, not an
  // open-ended feed - unlike contacts/companies, this does not paginate.
  const isTeamAdmin = teamMembership.role === 'admin'
  const inboxes = isTeamAdmin
    ? await db
        .select()
        .from(supportInbox)
        .where(eq(supportInbox.teamId, query.teamId))
        .orderBy(asc(supportInbox.createdAt))
    : await db
        .select()
        .from(supportInbox)
        .innerJoin(supportInboxMember, eq(supportInboxMember.inboxId, supportInbox.id))
        .where(and(eq(supportInbox.teamId, query.teamId), eq(supportInboxMember.userId, session.user.id)))
        .orderBy(asc(supportInbox.createdAt))

  const data = inboxes
    .map((row) => {
      if (isTeamAdmin) {
        return {
          ...row,
          effectiveRole: 'admin' as SupportInboxRole,
          isTeamAdmin: true,
          capabilities: capabilitiesForRole('admin', true),
        }
      }

      const inbox = ('supportInbox' in row ? row.supportInbox : row) as typeof supportInbox.$inferSelect
      const member = 'supportInboxMember' in row ? row.supportInboxMember : row
      const effectiveRole = parseSupportInboxRole((member as { role?: unknown }).role)
      if (!effectiveRole) {
        return null
      }
      return {
        ...inbox,
        effectiveRole,
        isTeamAdmin: false,
        capabilities: capabilitiesForRole(effectiveRole, false),
      }
    })
    .filter((inbox): inbox is NonNullable<typeof inbox> => inbox !== null)

  return createSuccessResponse({ inboxes: data })
})
