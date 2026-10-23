import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { withOriginHeaders, type LoginCredentials } from './auth'
import { account, member, session, user, verification } from '../../../server/database/schema/auth'
import { projectMember } from '../../../server/database/schema/feedback'

const PASSWORD = 'password123'
export const SEEDED_ORG_ID = 'seed_preview_org'

export type WorkspaceMemberFixture = LoginCredentials & {
  userId: string
  memberId: string
  projectMemberId: string | null
}

/**
 * Signs up a brand new user and adds it to the seeded workspace as a plain `member`.
 * Pass `projectId` + `projectRole` to also give an explicit project role; without it the user only
 * has the implicit access every workspace member has to a workspace-wide project (project role `member`).
 */
export async function createWorkspaceMember(
  request: APIRequestContext,
  options: { projectId?: string; projectRole?: 'admin' | 'member' } = {}
): Promise<WorkspaceMemberFixture> {
  const suffix = randomUUID().slice(0, 8)
  const credentials: LoginCredentials = { email: `e2e-member-${suffix}@example.com`, password: PASSWORD }

  let response = await request.post('/api/auth/sign-up/email', {
    headers: withOriginHeaders('/signup'),
    data: { name: `E2E Member ${suffix}`, ...credentials },
  })
  for (let attempt = 1; response.status() === 503 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    response = await request.post('/api/auth/sign-up/email', {
      headers: withOriginHeaders('/signup'),
      data: { name: `E2E Member ${suffix}`, ...credentials },
    })
  }
  if (!response.ok()) throw new Error(`Could not sign up member: ${response.status()} ${await response.text()}`)
  const userId = (await response.json())?.user?.id as string | undefined
  if (!userId) throw new Error(`Sign-up did not create a user row for ${credentials.email}`)

  const now = new Date()
  const memberId = randomUUID()
  await db.insert(member).values({
    id: memberId,
    organizationId: SEEDED_ORG_ID,
    userId,
    role: 'member',
    createdAt: now,
    updatedAt: now,
  })

  let projectMemberId: string | null = null
  if (options.projectId) {
    projectMemberId = randomUUID()
    await db.insert(projectMember).values({
      id: projectMemberId,
      projectId: options.projectId,
      userId,
      role: options.projectRole ?? 'member',
      createdAt: now,
    })
  }

  return { ...credentials, userId, memberId, projectMemberId }
}

export async function cleanupWorkspaceMember(fixture: WorkspaceMemberFixture) {
  if (fixture.projectMemberId) await db.delete(projectMember).where(eq(projectMember.id, fixture.projectMemberId))
  await db.delete(member).where(eq(member.id, fixture.memberId))
  await db.delete(verification).where(eq(verification.identifier, fixture.email))
  await db.delete(session).where(eq(session.userId, fixture.userId))
  await db.delete(account).where(eq(account.userId, fixture.userId))
  await db.delete(user).where(eq(user.id, fixture.userId))
}
