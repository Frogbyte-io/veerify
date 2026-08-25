import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { signInAndGetSessionCookie, withAuthHeaders, type LoginCredentials } from './auth'
import { account, session, teamMember, user } from '../../../server/database/schema/auth'
import { contact, conversation, supportInbox, supportInboxMember } from '../../../server/database/schema/support'

const PASSWORD = 'password123'
const SEEDED_TEAM_ID = 'seed_preview_team'

export type SupportPermissionRole = 'teamAdmin' | 'inboxAdmin' | 'supervisor' | 'agent' | 'unassigned'

export type SupportPermissionFixture = {
  teamId: string
  primaryInboxId: string
  primaryInboxName: string
  forbiddenInboxId: string
  forbiddenInboxName: string
  forbiddenConversationId: string
  users: Record<SupportPermissionRole, LoginCredentials & { userId: string }>
  userIds: string[]
  teamMemberIds: string[]
  inboxMemberIds: string[]
  inboxIds: string[]
  contactIds: string[]
  conversationIds: string[]
}

type CreatedUser = LoginCredentials & { userId: string }

async function signUpUniqueUser(request: APIRequestContext, role: SupportPermissionRole, suffix: string) {
  const credentials: LoginCredentials = {
    email: `support-permissions-${role}-${suffix}@example.com`,
    password: PASSWORD,
  }

  let response = await request.post('/api/auth/sign-up/email', {
    data: { name: `Permissions ${role}`, ...credentials },
  })
  for (let attempt = 1; response.status() === 503 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    response = await request.post('/api/auth/sign-up/email', {
      data: { name: `Permissions ${role}`, ...credentials },
    })
  }
  if (!response.ok()) {
    throw new Error(`Could not sign up ${role}: ${response.status()} ${await response.text()}`)
  }

  const payload = await response.json()
  const created = payload?.user?.id ? { id: payload.user.id as string } : undefined
  if (!created) throw new Error(`Sign-up did not create a user row for ${credentials.email}`)
  return { ...credentials, userId: created.id }
}

/**
 * Creates isolated role fixtures through the public auth surface, then adds
 * only the fixed team/inbox memberships needed by the permission matrix.
 * IDs are returned to make cleanup ownership explicit.
 */
export async function createSupportPermissionFixture(request: APIRequestContext): Promise<SupportPermissionFixture> {
  const suffix = randomUUID().slice(0, 8)
  const roles: SupportPermissionRole[] = ['teamAdmin', 'inboxAdmin', 'supervisor', 'agent', 'unassigned']
  const createdUsers = {} as Record<SupportPermissionRole, CreatedUser>

  for (const role of roles) {
    createdUsers[role] = await signUpUniqueUser(request, role, suffix)
  }

  const now = new Date()
  const primaryInboxId = randomUUID()
  const forbiddenInboxId = randomUUID()
  const primaryInboxName = `Permissions Inbox ${suffix}`
  const forbiddenInboxName = `Restricted Inbox ${suffix}`
  const inboxIds = [primaryInboxId, forbiddenInboxId]

  await db.insert(supportInbox).values([
    {
      id: primaryInboxId,
      teamId: SEEDED_TEAM_ID,
      name: primaryInboxName,
      slug: `permissions-${suffix}`,
      type: 'email',
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: forbiddenInboxId,
      teamId: SEEDED_TEAM_ID,
      name: forbiddenInboxName,
      slug: `restricted-${suffix}`,
      type: 'email',
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ])

  const teamMemberIds = roles.map(() => randomUUID())
  await db.insert(teamMember).values(
    roles.map((role, index) => ({
      id: teamMemberIds[index],
      teamId: SEEDED_TEAM_ID,
      userId: createdUsers[role].userId,
      role: role === 'teamAdmin' ? 'admin' : 'member',
      createdAt: now,
    }))
  )

  // Team admins also receive an explicit admin row so this fixture exercises
  // both the team-admin bypass and the inbox-role payload.
  const assignedRoles: Array<[SupportPermissionRole, 'admin' | 'supervisor' | 'agent']> = [
    ['teamAdmin', 'admin'],
    ['inboxAdmin', 'admin'],
    ['supervisor', 'supervisor'],
    ['agent', 'agent'],
  ]
  const inboxMemberIds = assignedRoles.map(() => randomUUID())
  await db.insert(supportInboxMember).values(
    assignedRoles.map(([role], index) => ({
      id: inboxMemberIds[index],
      inboxId: primaryInboxId,
      userId: createdUsers[role].userId,
      role: assignedRoles[index][1],
      createdAt: now,
    }))
  )

  const persistedInboxMembers = await db
    .select({ userId: supportInboxMember.userId, inboxId: supportInboxMember.inboxId, role: supportInboxMember.role })
    .from(supportInboxMember)
    .innerJoin(supportInbox, eq(supportInboxMember.inboxId, supportInbox.id))
    .where(inArray(supportInboxMember.userId, assignedRoles.map(([role]) => createdUsers[role].userId)))
  const expectedMemberships = assignedRoles.map(([role, inboxRole]) =>
    `${createdUsers[role].userId}:${primaryInboxId}:${inboxRole}`
  )
  const actualMemberships = persistedInboxMembers.map(({ userId, inboxId, role }) => `${userId}:${inboxId}:${role}`)
  for (const expected of expectedMemberships) {
    if (!actualMemberships.includes(expected)) throw new Error(`Fixture membership did not persist: ${expected}`)
  }

  // Seed one conversation in the inaccessible inbox so the browser can prove
  // that a deep-link 403 recovers without leaking the rejected inbox name.
  const adminCookie = await signInAndGetSessionCookie(request, createdUsers.teamAdmin)
  const activeTeamResponse = await request.post('/api/teams/active', {
    headers: withAuthHeaders(adminCookie, '/support'),
    data: { teamId: SEEDED_TEAM_ID },
  })
  if (!activeTeamResponse.ok()) throw new Error(`Could not activate the fixed team: ${await activeTeamResponse.text()}`)
  const headers = withAuthHeaders(adminCookie, '/support')
  const contactResponse = await request.post('/api/support/contacts', {
    headers,
    data: {
      teamId: SEEDED_TEAM_ID,
      name: `Permission Customer ${suffix}`,
      email: `permission-customer-${suffix}@example.com`,
    },
  })
  if (!contactResponse.ok()) throw new Error(`Could not create permission contact: ${await contactResponse.text()}`)
  const contactId = (await contactResponse.json()).data.contact.id as string

  const conversationResponse = await request.post('/api/support/conversations', {
    headers,
    data: { inboxId: forbiddenInboxId, contactId, subject: `Restricted conversation ${suffix}` },
  })
  if (!conversationResponse.ok()) {
    throw new Error(`Could not create restricted conversation: ${await conversationResponse.text()}`)
  }
  const forbiddenConversationId = (await conversationResponse.json()).data.conversation.id as string

  return {
    teamId: SEEDED_TEAM_ID,
    primaryInboxId,
    primaryInboxName,
    forbiddenInboxId,
    forbiddenInboxName,
    forbiddenConversationId,
    users: createdUsers,
    userIds: roles.map((role) => createdUsers[role].userId),
    teamMemberIds,
    inboxMemberIds,
    inboxIds,
    contactIds: [contactId],
    conversationIds: [forbiddenConversationId],
  }
}

/** Deletes only rows owned by createSupportPermissionFixture, FK children first. */
export async function cleanupSupportPermissionFixture(fixture: SupportPermissionFixture) {
  await db.delete(conversation).where(inArray(conversation.id, fixture.conversationIds))
  await db.delete(contact).where(inArray(contact.id, fixture.contactIds))
  await db.delete(supportInboxMember).where(inArray(supportInboxMember.id, fixture.inboxMemberIds))
  await db.delete(supportInbox).where(inArray(supportInbox.id, fixture.inboxIds))
  await db.delete(session).where(inArray(session.userId, fixture.userIds))
  await db.delete(account).where(inArray(account.userId, fixture.userIds))
  await db.delete(teamMember).where(inArray(teamMember.id, fixture.teamMemberIds))
  await db.delete(user).where(inArray(user.id, fixture.userIds))
}
