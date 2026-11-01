import { eq, and, inArray, ne } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  contact,
  supportCompany,
  supportInbox,
  supportInboxMember,
  projectMailAddress,
  projectMailDomain,
  conversation,
} from '~/server/database/schema/support'
import { member } from '~/server/database/schema/auth'
import { project, projectMember } from '~/server/database/schema/feedback'
import { requireProjectAccess, requireProjectRole, resolveProjectRole } from './project-access'
import { createErrorResponse, ErrorCode } from './response'
import { CATCH_ALL_LOCAL_PART, catchAllAddressFor, splitMailAddress } from '~/lib/mail-address'

export type SupportInboxRole = 'agent' | 'supervisor' | 'admin'

export type SupportCapabilities = {
  canWorkConversations: boolean
  canManageTagVocabulary: boolean
  canManageMembers: boolean
  canManageInbox: boolean
  canManageProjectSupport: boolean
}

export type InboxAccess = typeof supportInbox.$inferSelect & {
  effectiveRole: SupportInboxRole
  isProjectAdmin: boolean
  capabilities: SupportCapabilities
}

const SUPPORT_ROLE_RANK: Record<SupportInboxRole, number> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
}

export const SUPPORT_INBOX_FORBIDDEN_MESSAGE = 'You do not have access to this support inbox'

/**
 * `role: null` means a project member who belongs to no support inbox and is not a
 * project admin. They get no support capability at all -- the approved matrix's
 * "Unassigned project member" column is `No` for every conversation capability.
 * Defaulting such a caller to `agent` made the UI advertise controls whose every
 * action `requireInboxAccess` then refused.
 */
export function capabilitiesForRole(role: SupportInboxRole | null, isProjectAdmin: boolean): SupportCapabilities {
  if (!role) {
    return {
      canWorkConversations: false,
      canManageTagVocabulary: false,
      canManageMembers: false,
      canManageInbox: false,
      canManageProjectSupport: isProjectAdmin,
    }
  }

  const rank = SUPPORT_ROLE_RANK[role]
  return {
    canWorkConversations: rank >= SUPPORT_ROLE_RANK.agent,
    canManageTagVocabulary: rank >= SUPPORT_ROLE_RANK.supervisor,
    canManageMembers: rank >= SUPPORT_ROLE_RANK.admin,
    canManageInbox: rank >= SUPPORT_ROLE_RANK.admin,
    canManageProjectSupport: isProjectAdmin,
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
  isProjectAdmin: boolean
): InboxAccess {
  return {
    ...inbox,
    effectiveRole,
    isProjectAdmin,
    capabilities: capabilitiesForRole(effectiveRole, isProjectAdmin),
  }
}

/**
 * Authorization helpers for the support platform.
 *
 * Mirrors `server/utils/project-access.ts`: resolve the entity, resolve its
 * project, then check membership. 404 when the entity does not exist, 403 when it
 * does but the caller is not a member.
 */

/**
 * Verify the user may act on a contact, via membership of the contact's project.
 *
 * Throws 404 if the contact does not exist, 403 if it does but the user is not
 * a member of its project. Distinguishing the two is deliberate and matches
 * `project-access.ts`: contact ids are opaque and only ever surfaced to users
 * who already have project access, so a 404 leaks nothing useful.
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

  await requireProjectAccess(row.projectId, userId)

  return row
}

/**
 * Verify the user may act on a company, via membership of the company's project.
 *
 * Same 404/403 split as `requireContactAccess`, for the same reason: company
 * ids are opaque and only ever shown to users who already have project access.
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

  await requireProjectAccess(row.projectId, userId)

  return row
}

/**
 * Verify the user may act on an inbox.
 *
 * Unlike `requireContactAccess`, support permissions do not live on
 * `projectMember` — a caller is authorized if they are a `supportInboxMember` of
 * this inbox, **or** hold the `admin` role on the inbox's project (support leads
 * need to reach an inbox before anyone has explicitly added them to it).
 * `projectMember.role` semantics are otherwise unchanged (delta D-28).
 */
type SupportAccessExecutor = Pick<typeof db, 'select'>

export async function requireInboxAccess(inboxId: string, userId: string, executor: SupportAccessExecutor = db) {
  const [inbox] = await executor.select().from(supportInbox).where(eq(supportInbox.id, inboxId)).limit(1)

  if (!inbox) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Inbox not found'),
    })
  }

  const [membership] = await executor
    .select({ id: supportInboxMember.id, role: supportInboxMember.role })
    .from(supportInboxMember)
    .where(and(eq(supportInboxMember.inboxId, inboxId), eq(supportInboxMember.userId, userId)))
    .limit(1)

  const [proj] = await executor.select().from(project).where(eq(project.id, inbox.projectId)).limit(1)
  const projectRole = proj ? await resolveProjectRole(proj, userId) : null

  if (projectRole === 'admin') {
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

export async function resolveSupportProjectRole(
  projectId: string,
  userId: string
): Promise<{ effectiveRole: SupportInboxRole; isProjectAdmin: boolean } | null> {
  const { role } = await requireProjectRole(projectId, userId)
  if (role === 'admin') {
    return { effectiveRole: 'admin', isProjectAdmin: true }
  }

  const supportMemberships = await db
    .select({ role: supportInboxMember.role })
    .from(supportInboxMember)
    .innerJoin(supportInbox, eq(supportInbox.id, supportInboxMember.inboxId))
    .where(and(eq(supportInbox.projectId, projectId), eq(supportInboxMember.userId, userId)))

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
  return { effectiveRole, isProjectAdmin: false }
}

export async function requireSupportProjectRole(
  projectId: string,
  userId: string,
  minimumRole: 'agent' | 'supervisor'
): Promise<{ effectiveRole: SupportInboxRole; isProjectAdmin: boolean }> {
  const access = await resolveSupportProjectRole(projectId, userId)
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
export async function requireConversationAccess(
  conversationId: string,
  userId: string,
  executor: SupportAccessExecutor = db
) {
  const [row] = await executor.select().from(conversation).where(eq(conversation.id, conversationId)).limit(1)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Conversation not found'),
    })
  }

  await requireInboxAccess(row.inboxId, userId, executor)

  return row
}

export type InboundAddressLookup = {
  /** The `projectMailAddress.address` to look up. */
  address: string
  matchedBy: 'exact' | 'catch_all'
  /** The recipient (lowercased) the lookup was made for. */
  recipient: string
}

/**
 * The address rows to look up for an inbound message, in the order they win.
 * Pure, so the precedence is unit tested without a database.
 *
 * Every recipient's exact address comes first, in the recipients' order. Only
 * when none matches is each recipient's catch-all (`*@<its domain>`) tried, in
 * the same order. A catch-all covers exactly its own domain: `x@sub.acme.com`
 * looks up `*@sub.acme.com`, never `*@acme.com`. A recipient that is literally
 * `*@domain` takes part as a catch-all lookup only, so it cannot outrank another
 * recipient's exact address.
 */
export function inboundAddressLookupOrder(recipients: string[]): InboundAddressLookup[] {
  const exact: InboundAddressLookup[] = []
  const catchAll: InboundAddressLookup[] = []
  const seen = new Set<string>()
  const add = (list: InboundAddressLookup[], lookup: InboundAddressLookup) => {
    if (seen.has(lookup.address)) return
    seen.add(lookup.address)
    list.push(lookup)
  }
  for (const raw of recipients) {
    const recipient = raw.trim().toLowerCase()
    const parts = splitMailAddress(recipient)
    if (!parts) continue
    if (parts.localPart !== CATCH_ALL_LOCAL_PART) add(exact, { address: recipient, matchedBy: 'exact', recipient })
    add(catchAll, { address: catchAllAddressFor(parts.domain), matchedBy: 'catch_all', recipient })
  }
  return [...exact, ...catchAll]
}

export type ResolvedInboundInbox = {
  inbox: typeof supportInbox.$inferSelect
  /** The address row that matched; its id and behaviour are recorded on a new conversation. */
  address: typeof projectMailAddress.$inferSelect
  matchedBy: 'exact' | 'catch_all'
  /** The recipient (lowercased) the match was made for. */
  recipient: string
}

/**
 * Resolve the inbox (and matched receiving address) an inbound email should
 * land in, from its routing recipients in order (see `inboundRoutingRecipients`).
 *
 * Exact `projectMailAddress.address` matches for every recipient are tried
 * before any catch-all (`inboundAddressLookupOrder`). A catch-all row only
 * counts while it sits on a mail domain of its own project that is not being
 * deleted, so a stale `*@domain` row can never capture mail.
 *
 * Returns `null` rather than throwing on no match: the endpoint records the
 * event as an error and returns 200 rather than 404ing, since the sender is a
 * mail provider that would otherwise retry forever. Not an authorization
 * check, so it takes no `userId`. Addresses are matched case-insensitively.
 */
export async function resolveInboxForRecipients(recipients: string[]): Promise<ResolvedInboundInbox | null> {
  const order = inboundAddressLookupOrder(recipients)
  const exactAddresses = order.filter((lookup) => lookup.matchedBy === 'exact').map((lookup) => lookup.address)
  const catchAllAddresses = order.filter((lookup) => lookup.matchedBy === 'catch_all').map((lookup) => lookup.address)

  const rows: (typeof projectMailAddress.$inferSelect)[] = []
  if (exactAddresses.length > 0) {
    rows.push(
      ...(await db.select().from(projectMailAddress).where(inArray(projectMailAddress.address, exactAddresses)))
    )
  }
  // Catch-alls are only read when no exact address matched.
  if (rows.length === 0 && catchAllAddresses.length > 0) {
    const catchAlls = await db
      .select({ address: projectMailAddress })
      .from(projectMailAddress)
      .innerJoin(
        projectMailDomain,
        and(
          eq(projectMailDomain.id, projectMailAddress.domainId),
          eq(projectMailDomain.projectId, projectMailAddress.projectId)
        )
      )
      .where(and(inArray(projectMailAddress.address, catchAllAddresses), ne(projectMailDomain.status, 'deleting')))
    rows.push(...catchAlls.map((row) => row.address))
  }

  for (const lookup of order) {
    const address = rows.find((row) => row.address === lookup.address)
    if (!address) continue
    const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, address.inboxId)).limit(1)
    if (!inbox) continue
    return { inbox, address, matchedBy: lookup.matchedBy, recipient: lookup.recipient }
  }
  return null
}

/** `resolveInboxForRecipients` for a single address. */
export async function resolveInboxByAddress(emailAddress: string) {
  return resolveInboxForRecipients([emailAddress])
}

/**
 * User ids that administer a project: organization owners/admins plus
 * `project_member` rows with role 'admin' (who must still belong to the org).
 */
export async function listProjectAdminUserIds(
  projectId: string,
  executor: SupportAccessExecutor = db
): Promise<string[]> {
  const [proj] = await executor.select().from(project).where(eq(project.id, projectId)).limit(1)
  if (!proj) return []

  const orgAdmins = await executor
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, proj.organizationId), inArray(member.role, ['owner', 'admin'])))

  const projectAdmins = await executor
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .innerJoin(member, and(eq(member.userId, projectMember.userId), eq(member.organizationId, proj.organizationId)))
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, 'admin')))

  return [...new Set([...orgAdmins, ...projectAdmins].map((row) => row.userId))]
}

/**
 * User ids that can open a project (the people an assignment may target):
 * org owners/admins, every org member on a 'workspace' project, or only those
 * with a `project_member` row on a 'restricted' project.
 */
export async function listProjectUserIds(projectId: string, executor: SupportAccessExecutor = db): Promise<string[]> {
  const [proj] = await executor.select().from(project).where(eq(project.id, projectId)).limit(1)
  if (!proj) return []

  const orgMembers = await executor
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, proj.organizationId))
  const explicit = await executor
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(eq(projectMember.projectId, projectId))
  const explicitIds = new Set(explicit.map((row) => row.userId))

  return orgMembers
    .filter(
      (row) =>
        row.role === 'owner' || row.role === 'admin' || proj.accessMode !== 'restricted' || explicitIds.has(row.userId)
    )
    .map((row) => row.userId)
}

/**
 * Every inbox the user can work in across the given projects (All projects): all inboxes of projects
 * they administer, plus inboxes they are a member of elsewhere. Same rule as `requireInboxAccess`.
 * `projects` must already be access-checked (e.g. from `requireScopedProjects`).
 */
export async function listAccessibleInboxes(
  userId: string,
  projects: Array<{ id: string; role: 'admin' | 'member' }>,
  executor: SupportAccessExecutor = db
): Promise<InboxAccess[]> {
  if (projects.length === 0) return []
  const adminProjectIds = new Set(projects.filter((p) => p.role === 'admin').map((p) => p.id))
  const inboxes = await executor
    .select()
    .from(supportInbox)
    .where(
      inArray(
        supportInbox.projectId,
        projects.map((p) => p.id)
      )
    )
  if (inboxes.length === 0) return []

  const memberships = await executor
    .select({ inboxId: supportInboxMember.inboxId, role: supportInboxMember.role })
    .from(supportInboxMember)
    .where(
      and(
        eq(supportInboxMember.userId, userId),
        inArray(
          supportInboxMember.inboxId,
          inboxes.map((i) => i.id)
        )
      )
    )
  const roleByInbox = new Map(memberships.map((m) => [m.inboxId, parseSupportInboxRole(m.role)]))

  const result: InboxAccess[] = []
  for (const inbox of inboxes) {
    if (adminProjectIds.has(inbox.projectId)) {
      result.push(withInboxAccess(inbox, 'admin', true))
      continue
    }
    const role = roleByInbox.get(inbox.id)
    if (role) result.push(withInboxAccess(inbox, role, false))
  }
  return result
}
