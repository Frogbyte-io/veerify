import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { enableProjectSupport } from './support-project'
import { signInAndGetSessionCookie, withAuthHeaders, withOriginHeaders, type LoginCredentials } from './auth'
import { account, session, member, user, verification } from '../../../server/database/schema/auth'
import { projectMember } from '../../../server/database/schema/feedback'
import {
  contact,
  conversation,
  supportInbox,
  supportInboxAddress,
  supportInboxMember,
} from '../../../server/database/schema/support'

const PASSWORD = 'password123'
const SEEDED_PROJECT_ID = 'seed_preview_project'
const SEEDED_ORG_ID = 'seed_preview_org'

export type SupportPermissionRole = 'projectAdmin' | 'inboxAdmin' | 'supervisor' | 'agent' | 'unassigned'

export type SupportPermissionFixture = {
  projectId: string
  primaryInboxId: string
  primaryInboxName: string
  forbiddenInboxId: string
  forbiddenInboxName: string
  forbiddenConversationId: string
  users: Record<SupportPermissionRole, LoginCredentials & { userId: string }>
  userIds: string[]
  userEmails: string[]
  projectMemberIds: string[]
  orgMemberIds: string[]
  inboxMemberIds: string[]
  inboxIds: string[]
  contactIds: string[]
  conversationIds: string[]
}

type CreatedUser = LoginCredentials & { userId: string }

async function signUpUniqueUser(
  request: APIRequestContext,
  role: SupportPermissionRole,
  credentials: LoginCredentials
): Promise<CreatedUser> {
  let response = await request.post('/api/auth/sign-up/email', {
    headers: withOriginHeaders('/signup'),
    data: { name: `Permissions ${role}`, ...credentials },
  })
  for (let attempt = 1; response.status() === 503 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    response = await request.post('/api/auth/sign-up/email', {
      headers: withOriginHeaders('/signup'),
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
 * only the fixed org/project/inbox memberships needed by the permission matrix.
 * IDs are returned to make cleanup ownership explicit.
 */
export async function createSupportPermissionFixture(request: APIRequestContext): Promise<SupportPermissionFixture> {
  const suffix = randomUUID().slice(0, 8)
  const roles: SupportPermissionRole[] = ['projectAdmin', 'inboxAdmin', 'supervisor', 'agent', 'unassigned']
  const createdUsers = {} as Record<SupportPermissionRole, CreatedUser>
  const fixture = {
    projectId: SEEDED_PROJECT_ID,
    primaryInboxId: '',
    primaryInboxName: '',
    forbiddenInboxId: '',
    forbiddenInboxName: '',
    forbiddenConversationId: '',
    users: createdUsers,
    userIds: [] as string[],
    userEmails: [] as string[],
    projectMemberIds: [] as string[],
    orgMemberIds: [] as string[],
    inboxMemberIds: [] as string[],
    inboxIds: [] as string[],
    contactIds: [] as string[],
    conversationIds: [] as string[],
  }

  try {
    for (const role of roles) {
      const credentials: LoginCredentials = {
        email: `support-permissions-${role}-${suffix}@example.com`,
        password: PASSWORD,
      }
      // Claim ownership before the request: an ambiguous response can still
      // have committed the user and its verification row.
      fixture.userEmails.push(credentials.email)
      try {
        createdUsers[role] = await signUpUniqueUser(request, role, credentials)
      } catch (error) {
        const [persisted] = await db.select({ id: user.id }).from(user).where(eq(user.email, credentials.email))
        if (persisted && !fixture.userIds.includes(persisted.id)) fixture.userIds.push(persisted.id)
        throw error
      }
      fixture.userIds.push(createdUsers[role].userId)
    }

    // Seeded projects ship with Support off.
    await enableProjectSupport(SEEDED_PROJECT_ID)

    const now = new Date()
    const primaryInboxId = randomUUID()
    const forbiddenInboxId = randomUUID()
    const primaryInboxName = `Permissions Inbox ${suffix}`
    const forbiddenInboxName = `Restricted Inbox ${suffix}`
    const inboxIds = [primaryInboxId, forbiddenInboxId]
    fixture.primaryInboxId = primaryInboxId
    fixture.primaryInboxName = primaryInboxName
    fixture.forbiddenInboxId = forbiddenInboxId
    fixture.forbiddenInboxName = forbiddenInboxName
    fixture.inboxIds.push(...inboxIds)

    await db.insert(supportInbox).values([
      {
        id: primaryInboxId,
        projectId: SEEDED_PROJECT_ID,
        name: primaryInboxName,
        slug: `permissions-${suffix}`,
        type: 'email',
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: forbiddenInboxId,
        projectId: SEEDED_PROJECT_ID,
        name: forbiddenInboxName,
        slug: `restricted-${suffix}`,
        type: 'email',
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ])

    // Everyone joins the seeded organization as a plain member (the project is workspace-wide, so
    // they can open it); the project admin additionally gets an explicit project admin row.
    const orgMemberIds = roles.map(() => randomUUID())
    fixture.orgMemberIds.push(...orgMemberIds)
    await db.insert(member).values(
      roles.map((role, index) => ({
        id: orgMemberIds[index],
        organizationId: SEEDED_ORG_ID,
        userId: createdUsers[role].userId,
        role: 'member',
        createdAt: now,
        updatedAt: now,
      }))
    )
    const projectMemberIds = [randomUUID()]
    fixture.projectMemberIds.push(...projectMemberIds)
    await db.insert(projectMember).values({
      id: projectMemberIds[0],
      projectId: SEEDED_PROJECT_ID,
      userId: createdUsers.projectAdmin.userId,
      role: 'admin',
      createdAt: now,
    })

    // Project admins also receive an explicit admin row so this fixture exercises
    // both the project-admin bypass and the inbox-role payload.
    const assignedRoles: Array<[SupportPermissionRole, 'admin' | 'supervisor' | 'agent']> = [
      ['projectAdmin', 'admin'],
      ['inboxAdmin', 'admin'],
      ['supervisor', 'supervisor'],
      ['agent', 'agent'],
    ]
    const inboxMemberIds = assignedRoles.map(() => randomUUID())
    fixture.inboxMemberIds.push(...inboxMemberIds)
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
      .where(
        inArray(
          supportInboxMember.userId,
          assignedRoles.map(([role]) => createdUsers[role].userId)
        )
      )
    const expectedMemberships = assignedRoles.map(
      ([role, inboxRole]) => `${createdUsers[role].userId}:${primaryInboxId}:${inboxRole}`
    )
    const actualMemberships = persistedInboxMembers.map(({ userId, inboxId, role }) => `${userId}:${inboxId}:${role}`)
    for (const expected of expectedMemberships) {
      if (!actualMemberships.includes(expected)) throw new Error(`Fixture membership did not persist: ${expected}`)
    }

    // Seed one conversation in the inaccessible inbox so the browser can prove
    // that a deep-link 403 recovers without leaking the rejected inbox name.
    const adminCookie = await signInAndGetSessionCookie(request, createdUsers.projectAdmin)
    const activeProjectResponse = await request.post('/api/projects/active', {
      headers: withAuthHeaders(adminCookie, '/support'),
      data: { projectId: SEEDED_PROJECT_ID },
    })
    if (!activeProjectResponse.ok())
      throw new Error(`Could not activate the fixed project: ${await activeProjectResponse.text()}`)
    const headers = withAuthHeaders(adminCookie, '/support')
    const contactResponse = await request.post('/api/support/contacts', {
      headers,
      data: {
        projectId: SEEDED_PROJECT_ID,
        name: `Permission Customer ${suffix}`,
        email: `permission-customer-${suffix}@example.com`,
      },
    })
    if (!contactResponse.ok()) throw new Error(`Could not create permission contact: ${await contactResponse.text()}`)
    const contactId = (await contactResponse.json()).data.contact.id as string
    fixture.contactIds.push(contactId)

    const conversationResponse = await request.post('/api/support/conversations', {
      headers,
      data: { inboxId: forbiddenInboxId, contactId, subject: `Restricted conversation ${suffix}` },
    })
    if (!conversationResponse.ok()) {
      throw new Error(`Could not create restricted conversation: ${await conversationResponse.text()}`)
    }
    const forbiddenConversationId = (await conversationResponse.json()).data.conversation.id as string
    fixture.forbiddenConversationId = forbiddenConversationId
    fixture.conversationIds.push(forbiddenConversationId)

    return fixture
  } catch (error) {
    await cleanupSupportPermissionFixture(fixture)
    throw error
  }
}

/** Deletes only rows owned by createSupportPermissionFixture, FK children first. */
export async function cleanupSupportPermissionFixture(fixture: SupportPermissionFixture) {
  if (fixture.conversationIds.length)
    await db.delete(conversation).where(inArray(conversation.id, fixture.conversationIds))
  if (fixture.contactIds.length) await db.delete(contact).where(inArray(contact.id, fixture.contactIds))
  if (fixture.inboxIds.length) {
    await db.delete(supportInboxAddress).where(inArray(supportInboxAddress.inboxId, fixture.inboxIds))
    await db.delete(supportInboxMember).where(inArray(supportInboxMember.id, fixture.inboxMemberIds))
    await db.delete(supportInbox).where(inArray(supportInbox.id, fixture.inboxIds))
  }
  if (fixture.projectMemberIds.length)
    await db.delete(projectMember).where(inArray(projectMember.id, fixture.projectMemberIds))
  if (fixture.orgMemberIds.length) await db.delete(member).where(inArray(member.id, fixture.orgMemberIds))
  if (fixture.userEmails.length)
    await db.delete(verification).where(inArray(verification.identifier, fixture.userEmails))
  if (fixture.userIds.length) {
    await db.delete(session).where(inArray(session.userId, fixture.userIds))
    await db.delete(account).where(inArray(account.userId, fixture.userIds))
    await db.delete(user).where(inArray(user.id, fixture.userIds))
  }

  const assertNoOwned = async (label: string, rowsPromise: PromiseLike<Array<{ id: string }>>) => {
    const rows = await rowsPromise
    if (rows.length) throw new Error(`Fixture cleanup left owned ${label}: ${rows.map((row) => row.id).join(',')}`)
  }
  if (fixture.userEmails.length)
    await assertNoOwned(
      'verification rows',
      db.select({ id: verification.id }).from(verification).where(inArray(verification.identifier, fixture.userEmails))
    )
  if (fixture.userIds.length) {
    await assertNoOwned(
      'accounts',
      db.select({ id: account.id }).from(account).where(inArray(account.userId, fixture.userIds))
    )
    await assertNoOwned(
      'sessions',
      db.select({ id: session.id }).from(session).where(inArray(session.userId, fixture.userIds))
    )
  }
  if (fixture.projectMemberIds.length)
    await assertNoOwned(
      'project members',
      db.select({ id: projectMember.id }).from(projectMember).where(inArray(projectMember.id, fixture.projectMemberIds))
    )
  if (fixture.orgMemberIds.length)
    await assertNoOwned(
      'organization members',
      db.select({ id: member.id }).from(member).where(inArray(member.id, fixture.orgMemberIds))
    )
  if (fixture.inboxMemberIds.length)
    await assertNoOwned(
      'inbox members',
      db
        .select({ id: supportInboxMember.id })
        .from(supportInboxMember)
        .where(inArray(supportInboxMember.id, fixture.inboxMemberIds))
    )
  if (fixture.contactIds.length)
    await assertNoOwned(
      'contacts',
      db.select({ id: contact.id }).from(contact).where(inArray(contact.id, fixture.contactIds))
    )
  if (fixture.conversationIds.length)
    await assertNoOwned(
      'conversations',
      db.select({ id: conversation.id }).from(conversation).where(inArray(conversation.id, fixture.conversationIds))
    )

  if (fixture.userIds.length) {
    const remainingUsers = await db.select({ id: user.id }).from(user).where(inArray(user.id, fixture.userIds))
    if (remainingUsers.length)
      throw new Error(`Fixture cleanup left owned users: ${remainingUsers.map((row) => row.id).join(',')}`)
  }
  if (fixture.inboxIds.length) {
    const remainingInboxes = await db
      .select({ id: supportInbox.id })
      .from(supportInbox)
      .where(inArray(supportInbox.id, fixture.inboxIds))
    if (remainingInboxes.length)
      throw new Error(`Fixture cleanup left owned inboxes: ${remainingInboxes.map((row) => row.id).join(',')}`)
  }
}
