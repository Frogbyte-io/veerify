import { eq, and } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { contact, supportCompany, supportInbox, supportInboxMember, supportInboxAddress, conversation } from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Authorization helpers for the support platform.
 *
 * Mirrors `server/utils/project-access.ts`: resolve the entity, resolve its
 * team, then check membership. 404 when the entity does not exist, 403 when it
 * does but the caller is not a member.
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
 * Verify the user may act on a company, via membership of the company's team.
 *
 * Same 404/403 split as `requireContactAccess`, for the same reason: company
 * ids are opaque and only ever shown to users who already have team access.
 */
export async function requireCompanyAccess(companyId: string, userId: string) {
  const [row] = await db.select().from(supportCompany).where(eq(supportCompany.id, companyId)).limit(1)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Company not found'),
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

/**
 * Verify the user may act on an inbox.
 *
 * Unlike `requireContactAccess`, support permissions do not live on
 * `teamMember` — a caller is authorized if they are a `supportInboxMember` of
 * this inbox, **or** hold the `admin` role on the inbox's team (support leads
 * need to reach an inbox before anyone has explicitly added them to it).
 * `teamMember.role` semantics are otherwise unchanged (delta D-28).
 */
export async function requireInboxAccess(inboxId: string, userId: string) {
  const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, inboxId)).limit(1)

  if (!inbox) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Inbox not found'),
    })
  }

  const [membership] = await db
    .select({ id: supportInboxMember.id })
    .from(supportInboxMember)
    .where(and(eq(supportInboxMember.inboxId, inboxId), eq(supportInboxMember.userId, userId)))
    .limit(1)

  if (membership) {
    return inbox
  }

  const [teamAdmin] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, inbox.teamId), eq(teamMember.userId, userId), eq(teamMember.role, 'admin')))
    .limit(1)

  if (!teamAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this inbox'),
    })
  }

  return inbox
}

/**
 * Verify the user may act on a conversation, via access to its inbox.
 *
 * There is no separate conversation-level permission — a conversation is only
 * ever reachable through the inbox it belongs to, so the 404/403 split is
 * inherited from `requireInboxAccess`.
 */
export async function requireConversationAccess(conversationId: string, userId: string) {
  const [row] = await db.select().from(conversation).where(eq(conversation.id, conversationId)).limit(1)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Conversation not found'),
    })
  }

  await requireInboxAccess(row.inboxId, userId)

  return row
}

/**
 * Resolve the inbox (and matched receiving address) an inbound email should
 * land in, by exact match against `supportInboxAddress.address` (delta D-27).
 *
 * Returns `null` rather than throwing on no match — Stage 03 records the
 * event as an error and returns 200 rather than 404ing, since the sender is a
 * mail provider that would otherwise retry forever. Not an authorization
 * check, so it takes no `userId`.
 *
 * Addresses are matched case-insensitively; callers do not need to normalize
 * `emailAddress` first.
 */
export async function resolveInboxByAddress(emailAddress: string) {
  const normalized = emailAddress.trim().toLowerCase()

  const [address] = await db
    .select()
    .from(supportInboxAddress)
    .where(eq(supportInboxAddress.address, normalized))
    .limit(1)

  if (!address) {
    return null
  }

  const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, address.inboxId)).limit(1)

  if (!inbox) {
    return null
  }

  return { inbox, address }
}
