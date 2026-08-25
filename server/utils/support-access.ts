import { eq, and } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  contact,
  supportCompany,
  supportInbox,
  supportInboxMember,
  supportInboxAddress,
  conversation,
} from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'
import { createErrorResponse, ErrorCode } from './response'

export type SupportInboxRole = 'agent' | 'supervisor' | 'admin'

export type SupportCapabilities = {
  canWorkConversations: boolean
  canManageTagVocabulary: boolean
  canManageMembers: boolean
  canManageInbox: boolean
  canManageTeamSupport: boolean
}

export type InboxAccess = typeof supportInbox.$inferSelect & {
  effectiveRole: SupportInboxRole
  isTeamAdmin: boolean
  capabilities: SupportCapabilities
}

const SUPPORT_ROLE_RANK: Record<SupportInboxRole, number> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
}

export const SUPPORT_INBOX_FORBIDDEN_MESSAGE = 'You do not have access to this support inbox'

export function capabilitiesForRole(role: SupportInboxRole, isTeamAdmin: boolean): SupportCapabilities {
  const rank = SUPPORT_ROLE_RANK[role]
  return {
    canWorkConversations: rank >= SUPPORT_ROLE_RANK.agent,
    canManageTagVocabulary: rank >= SUPPORT_ROLE_RANK.supervisor,
    canManageMembers: rank >= SUPPORT_ROLE_RANK.admin,
    canManageInbox: rank >= SUPPORT_ROLE_RANK.admin,
    canManageTeamSupport: isTeamAdmin,
  }
}

function throwInboxForbidden(): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, SUPPORT_INBOX_FORBIDDEN_MESSAGE),
  })
}

export function parseSupportInboxRole(role: unknown): SupportInboxRole | null {
  if (role === 'agent' || role === 'supervisor' || role === 'admin') return role
  return null
}

function withInboxAccess(
  inbox: typeof supportInbox.$inferSelect,
  effectiveRole: SupportInboxRole,
  isTeamAdmin: boolean
): InboxAccess {
  return {
    ...inbox,
    effectiveRole,
    isTeamAdmin,
    capabilities: capabilitiesForRole(effectiveRole, isTeamAdmin),
  }
}

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

export async function requireTeamAdmin(teamId: string, userId: string) {
  const membership = await requireTeamMembership(teamId, userId)
  if (membership.role !== 'admin') {
    throwInboxForbidden()
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
    .select({ id: supportInboxMember.id, role: supportInboxMember.role })
    .from(supportInboxMember)
    .where(and(eq(supportInboxMember.inboxId, inboxId), eq(supportInboxMember.userId, userId)))
    .limit(1)

  const [teamAdmin] = await db
    .select({ id: teamMember.id, role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, inbox.teamId), eq(teamMember.userId, userId), eq(teamMember.role, 'admin')))
    .limit(1)

  if (teamAdmin) {
    return withInboxAccess(inbox, 'admin', true)
  }

  const memberRole = parseSupportInboxRole(membership?.role)
  if (!memberRole) {
    throwInboxForbidden()
  }
  return withInboxAccess(inbox, memberRole, false)
}

export async function requireInboxRole(
  inboxId: string,
  userId: string,
  minimumRole: SupportInboxRole
): Promise<InboxAccess> {
  const access = await requireInboxAccess(inboxId, userId)
  if (SUPPORT_ROLE_RANK[access.effectiveRole] < SUPPORT_ROLE_RANK[minimumRole]) {
    throwInboxForbidden()
  }
  return access
}

export async function resolveSupportTeamRole(
  teamId: string,
  userId: string
): Promise<{ effectiveRole: SupportInboxRole; isTeamAdmin: boolean } | null> {
  const membership = await requireTeamMembership(teamId, userId)
  if (membership.role === 'admin') {
    return { effectiveRole: 'admin', isTeamAdmin: true }
  }

  const supportMemberships = await db
    .select({ role: supportInboxMember.role })
    .from(supportInboxMember)
    .innerJoin(supportInbox, eq(supportInbox.id, supportInboxMember.inboxId))
    .where(and(eq(supportInbox.teamId, teamId), eq(supportInboxMember.userId, userId)))

  if (supportMemberships.length === 0) {
    return null
  }

  let effectiveRole: SupportInboxRole | null = null
  for (const supportMembership of supportMemberships) {
    const role = parseSupportInboxRole(supportMembership.role)
    if (!role) {
      throwInboxForbidden()
    }
    if (!effectiveRole || SUPPORT_ROLE_RANK[role] > SUPPORT_ROLE_RANK[effectiveRole]) {
      effectiveRole = role
    }
  }

  if (!effectiveRole) {
    return null
  }
  return { effectiveRole, isTeamAdmin: false }
}

export async function requireSupportTeamRole(
  teamId: string,
  userId: string,
  minimumRole: 'agent' | 'supervisor'
): Promise<{ effectiveRole: SupportInboxRole; isTeamAdmin: boolean }> {
  const access = await resolveSupportTeamRole(teamId, userId)
  if (!access || SUPPORT_ROLE_RANK[access.effectiveRole] < SUPPORT_ROLE_RANK[minimumRole]) {
    throwInboxForbidden()
  }
  return access
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
