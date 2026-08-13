import { eq, and } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { contact } from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Authorization helpers for the support platform.
 *
 * Mirrors `server/utils/project-access.ts`: resolve the entity, resolve its
 * team, then check membership. 404 when the entity does not exist, 403 when it
 * does but the caller is not a member.
 *
 * Stage 02 extends this file with `requireInboxAccess`,
 * `requireConversationAccess`, and `resolveInboxByAddress`.
 */

/**
 * Verify the user may act on a contact, via membership of the contact's team.
 *
 * Throws 404 if the contact does not exist, 403 if it does but the user is not
 * a member of its team. Distinguishing the two is deliberate and matches
 * `project-access.ts`: contact ids are opaque and only ever surfaced to users
 * who already have team access, so a 404 leaks nothing useful.
 */
export async function requireContactAccess(contactId: string, userId: string) {
  const [row] = await db.select().from(contact).where(eq(contact.id, contactId)).limit(1)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
    })
  }

  await requireTeamMembership(row.teamId, userId)

  return row
}

/**
 * Verify the user is a member of a team.
 *
 * Used directly by team-scoped support endpoints (contact list, contact create,
 * company CRUD) where there is no entity to resolve first — the team id comes
 * from the request and must still be proven.
 */
export async function requireTeamMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select({ id: teamMember.id, role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this team'),
    })
  }

  return membership
}
