import { randomBytes, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import {
  marketingEmailSuppression,
  organizationApiCredential,
  reviewRequest,
} from '../../server/database/schema/marketing'

vi.stubGlobal('createError', createError)
process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')

const { requireMarketingAccess, requireMarketingAdmin } = await import('../../server/utils/marketing-access')
const { getOrgApiKey, saveOrgCredential } = await import('../../server/utils/org-credentials')
const { getUsage, recordUsage } = await import('../../server/utils/marketing-usage')
const { consumeDbLimit } = await import('../../server/utils/marketing-db-limit')
const { eraseContact } = await import('../../server/services/marketing/privacy')

const now = new Date('2026-01-15T12:00:00.000Z')
const id = (name: string) => `mk_${name}_${randomUUID()}`
const ids = {
  orgA: id('orgA'),
  orgB: id('orgB'),
  owner: id('owner'),
  plain: id('plain'),
  projectA1: id('pa1'),
  projectA2: id('pa2'),
  projectB: id('pb'),
}

beforeAll(async () => {
  await db.insert(organization).values([
    { id: ids.orgA, name: 'Org A', slug: `mk-a-${randomUUID()}`, createdAt: now },
    { id: ids.orgB, name: 'Org B', slug: `mk-b-${randomUUID()}`, createdAt: now },
  ])
  await db.insert(user).values([
    { id: ids.owner, name: 'Owner', email: `owner-${randomUUID()}@example.com`, createdAt: now, updatedAt: now },
    { id: ids.plain, name: 'Plain', email: `plain-${randomUUID()}@example.com`, createdAt: now, updatedAt: now },
  ])
  await db.insert(member).values([
    { id: id('m1'), organizationId: ids.orgA, userId: ids.owner, role: 'owner', createdAt: now },
    { id: id('m2'), organizationId: ids.orgA, userId: ids.plain, role: 'member', createdAt: now },
  ])
  await db.insert(project).values([
    { id: ids.projectA1, organizationId: ids.orgA, slug: 'one', name: 'One', settings: { marketingEnabled: true } },
    { id: ids.projectA2, organizationId: ids.orgA, slug: 'two', name: 'Two', settings: null },
    { id: ids.projectB, organizationId: ids.orgB, slug: 'one', name: 'Other', settings: { marketingEnabled: true } },
  ])
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.orgA))
  await db.delete(organization).where(eq(organization.id, ids.orgB))
  await db.delete(user).where(eq(user.id, ids.owner))
  await db.delete(user).where(eq(user.id, ids.plain))
})

describe('requireMarketingAccess', () => {
  it('lets any project member in when the project switched marketing on', async () => {
    const access = await requireMarketingAccess(ids.projectA1, ids.plain)
    expect(access.organizationId).toBe(ids.orgA)
    expect(access.role).toBe('member')
  })

  it('refuses when the project has not switched marketing on', async () => {
    await expect(requireMarketingAccess(ids.projectA2, ids.owner)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses people outside the workspace', async () => {
    await expect(requireMarketingAccess(ids.projectB, ids.plain)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reserves admin actions for project admins (workspace owners/admins)', async () => {
    await expect(requireMarketingAdmin(ids.projectA1, ids.owner)).resolves.toMatchObject({ role: 'admin' })
    await expect(requireMarketingAdmin(ids.projectA1, ids.plain)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('workspace-level credentials, usage and limits', () => {
  it('stores keys per workspace and binds them to it', async () => {
    await saveOrgCredential({
      organizationId: ids.orgA,
      provider: 'anthropic',
      apiKey: 'sk-test-workspace-key',
      userId: ids.owner,
      status: 'valid',
    })
    expect((await getOrgApiKey(ids.orgA, 'anthropic'))?.apiKey).toBe('sk-test-workspace-key')
    expect(await getOrgApiKey(ids.orgB, 'anthropic')).toBeNull()

    // An envelope copied into another workspace's row fails to decrypt (associated data `org:<id>:<provider>`)
    const [row] = await db
      .select()
      .from(organizationApiCredential)
      .where(eq(organizationApiCredential.organizationId, ids.orgA))
    await db.insert(organizationApiCredential).values({ ...row, id: id('copy'), organizationId: ids.orgB })
    expect(await getOrgApiKey(ids.orgB, 'anthropic')).toBeNull()
  })

  it('counts usage and rate limits per workspace', async () => {
    await recordUsage(ids.orgA, 'test:metric', 3)
    await recordUsage(ids.orgA, 'test:metric', 2)
    expect((await getUsage(ids.orgA))['test:metric']).toBe(5)
    expect((await getUsage(ids.orgB))['test:metric']).toBeUndefined()

    expect((await consumeDbLimit(ids.orgA, 'ratelimit:test', 1)).allowed).toBe(true)
    expect((await consumeDbLimit(ids.orgA, 'ratelimit:test', 1)).allowed).toBe(false)
    expect((await consumeDbLimit(ids.orgB, 'ratelimit:test', 1)).allowed).toBe(true)
  })
})

describe('eraseContact', () => {
  it('erases across every project of the workspace and suppresses at workspace level', async () => {
    const email = `person-${randomUUID()}@example.com`
    const requestRow = (projectId: string, suffix: string) => ({
      id: id(suffix),
      projectId,
      email,
      trigger: 'manual' as const,
      token: `${suffix}-${randomUUID()}${randomUUID()}`,
    })
    await db
      .insert(reviewRequest)
      .values([requestRow(ids.projectA1, 'r1'), requestRow(ids.projectA2, 'r2'), requestRow(ids.projectB, 'r3')])

    const result = await eraseContact(ids.orgA, email)
    expect(result.reviewRequestsDeleted).toBe(2)

    const remaining = await db
      .select({ projectId: reviewRequest.projectId })
      .from(reviewRequest)
      .where(eq(reviewRequest.email, email))
    expect(remaining).toEqual([{ projectId: ids.projectB }])

    const suppressed = await db
      .select({ organizationId: marketingEmailSuppression.organizationId })
      .from(marketingEmailSuppression)
      .where(eq(marketingEmailSuppression.email, email))
    expect(suppressed).toEqual([{ organizationId: ids.orgA }])
  })
})
