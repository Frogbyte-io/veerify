import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { feedback, product, project, projectMember } from '../../server/database/schema/feedback'

/**
 * Runs the real project/product/member route handlers against a real Postgres
 * (only the session lookup is faked) to cover the access matrix, the default
 * product rules and the product delete/move rules end to end.
 */

type FakeEvent = {
  session: { user: { id: string }; session: { token: string; activeOrganizationId: string; activeProjectId: null } }
  params: Record<string, string>
  query: Record<string, string>
  body?: unknown
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name])
vi.stubGlobal('getQuery', (event: FakeEvent) => event.query)
vi.stubGlobal('readBody', async (event: FakeEvent) => event.body)
vi.stubGlobal('setResponseStatus', () => undefined)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async (event: FakeEvent) => event.session,
}))
vi.mock('~/server/services/marketing/search/connection', () => ({
  revokeGscTokensForProject: async () => undefined,
}))

const suffix = randomUUID().slice(0, 8)
const orgId = `pp_org_${suffix}`
const ids = {
  owner: `pp_owner_${suffix}`,
  member: `pp_member_${suffix}`,
  restrictedMember: `pp_restricted_${suffix}`,
  outsider: `pp_outsider_${suffix}`,
}
const userIds = Object.values(ids)

function eventFor(
  userId: string,
  options: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}
): FakeEvent {
  return {
    session: {
      user: { id: userId },
      session: { token: `tok_${userId}`, activeOrganizationId: orgId, activeProjectId: null },
    },
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body,
  }
}

async function call(path: string, event: FakeEvent) {
  const mod = await import(/* @vite-ignore */ `../../server/api/${path}`)
  return (mod.default as (e: FakeEvent) => Promise<{ success: boolean; data: any }>)(event)
}

async function expectStatus(promise: Promise<unknown>, statusCode: number) {
  await expect(promise).rejects.toMatchObject({ statusCode })
}

describe('projects & products routes (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'PP Test Org', slug: `pp-org-${suffix}` })
    await db
      .insert(user)
      .values(userIds.map((id) => ({ id, name: id, email: `${id}@example.com`, emailVerified: true })))
    await db.insert(member).values([
      { id: `${ids.owner}_m`, organizationId: orgId, userId: ids.owner, role: 'owner' },
      { id: `${ids.member}_m`, organizationId: orgId, userId: ids.member, role: 'member' },
      { id: `${ids.restrictedMember}_m`, organizationId: orgId, userId: ids.restrictedMember, role: 'member' },
    ])
  })

  afterAll(async () => {
    await db.delete(feedback).where(
      inArray(
        feedback.projectId,
        (await db.select({ id: project.id }).from(project).where(eq(project.organizationId, orgId))).map((p) => p.id)
      )
    )
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(user).where(inArray(user.id, userIds))
  })

  it('creates a project with a default product (org admins only)', async () => {
    await expectStatus(call('projects/index.post', eventFor(ids.member, { body: { name: 'Nope' } })), 403)

    const res = await call('projects/index.post', eventFor(ids.owner, { body: { name: 'Alpha Brand' } }))
    expect(res.data.project).toMatchObject({ slug: 'alpha-brand', role: 'admin', accessMode: 'workspace' })
    expect(res.data.product).toMatchObject({ name: 'Alpha Brand', slug: 'alpha-brand' })

    const products = await db.select().from(product).where(eq(product.projectId, res.data.project.id))
    expect(products).toHaveLength(1)
  })

  it('rejects reserved and duplicate project slugs, suffixes auto slugs', async () => {
    await expectStatus(call('projects/index.post', eventFor(ids.owner, { body: { name: 'X', slug: 'active' } })), 400)
    await expectStatus(
      call('projects/index.post', eventFor(ids.owner, { body: { name: 'Dup', slug: 'alpha-brand' } })),
      409
    )
    const auto = await call('projects/index.post', eventFor(ids.owner, { body: { name: 'Alpha Brand' } }))
    expect(auto.data.project.slug).toBe('alpha-brand-2')
  })

  it('gives the default product a non-reserved slug', async () => {
    const res = await call('projects/index.post', eventFor(ids.owner, { body: { name: 'Roadmap' } }))
    expect(res.data.project.slug).toBe('roadmap')
    expect(res.data.product.slug).toBe('roadmap-product')
  })

  it('lists members with their access source and honours restricted mode', async () => {
    const params = { slug: 'alpha-brand' }
    const open = await call('projects/[slug]/members/index.get', eventFor(ids.member, { params }))
    expect(open.data.accessMode).toBe('workspace')
    const bySource = Object.fromEntries(open.data.members.map((m: any) => [m.userId, m.source]))
    expect(bySource).toMatchObject({
      [ids.owner]: 'organization_admin',
      [ids.member]: 'workspace',
      [ids.restrictedMember]: 'workspace',
    })

    // Non-admins cannot change membership
    await expectStatus(
      call('projects/[slug]/members/index.post', eventFor(ids.member, { params, body: { userId: ids.member } })),
      403
    )

    await call('projects/[slug].put', eventFor(ids.owner, { params, body: { accessMode: 'restricted' } }))
    const restricted = await call('projects/[slug]/members/index.get', eventFor(ids.owner, { params }))
    expect(restricted.data.members.map((m: any) => m.userId)).toEqual([ids.owner])
    await expectStatus(call('projects/[slug]/members/index.get', eventFor(ids.member, { params })), 403)

    // Add / promote / remove
    const added = await call(
      'projects/[slug]/members/index.post',
      eventFor(ids.owner, { params, body: { userId: ids.member, role: 'member' } })
    )
    expect(added.data).toMatchObject({ userId: ids.member, role: 'member', source: 'project_member' })
    const visible = await call('projects/[slug]/members/index.get', eventFor(ids.member, { params }))
    expect(visible.data.members.map((m: any) => m.userId).sort()).toEqual([ids.owner, ids.member].sort())

    const promoted = await call(
      'projects/[slug]/members/[userId].patch',
      eventFor(ids.owner, { params: { ...params, userId: ids.member }, body: { role: 'admin' } })
    )
    expect(promoted.data.role).toBe('admin')

    await expectStatus(
      call('projects/[slug]/members/index.post', eventFor(ids.owner, { params, body: { userId: ids.outsider } })),
      404
    )
    await expectStatus(
      call('projects/[slug]/members/index.post', eventFor(ids.owner, { params, body: { userId: ids.owner } })),
      409
    )

    await call(
      'projects/[slug]/members/[userId].delete',
      eventFor(ids.owner, { params: { ...params, userId: ids.member } })
    )
    await expectStatus(call('projects/[slug]/members/index.get', eventFor(ids.member, { params })), 403)
    expect(await db.select().from(projectMember).where(eq(projectMember.userId, ids.member))).toHaveLength(0)

    await call('projects/[slug].put', eventFor(ids.owner, { params, body: { accessMode: 'workspace' } }))
  })

  it('lists only accessible projects', async () => {
    await call(
      'projects/[slug].put',
      eventFor(ids.owner, { params: { slug: 'roadmap' }, body: { accessMode: 'restricted' } })
    )
    const list = await call('projects/index.get', eventFor(ids.member))
    const slugs = list.data.map((p: any) => p.slug)
    expect(slugs).toContain('alpha-brand')
    expect(slugs).not.toContain('roadmap')
    expect(list.data[0].productCount).toBe(1)
  })

  it('manages products: reserved slugs, last-product guard, moveTo on delete', async () => {
    const params = { slug: 'alpha-brand' }
    await expectStatus(
      call(
        'projects/[slug]/products/index.post',
        eventFor(ids.owner, { params, body: { name: 'R', slug: 'roadmap' } })
      ),
      400
    )
    await expectStatus(
      call('projects/[slug]/products/index.post', eventFor(ids.member, { params, body: { name: 'Beta' } })),
      403
    )

    const beta = await call(
      'projects/[slug]/products/index.post',
      eventFor(ids.owner, { params, body: { name: 'Beta' } })
    )
    expect(beta.data).toMatchObject({ slug: 'beta', isPublic: true, sortOrder: 1 })
    await expectStatus(
      call(
        'projects/[slug]/products/index.post',
        eventFor(ids.owner, { params, body: { name: 'Beta', slug: 'beta' } })
      ),
      409
    )

    const renamed = await call(
      'projects/[slug]/products/[productId].put',
      eventFor(ids.owner, { params: { ...params, productId: beta.data.id }, body: { name: 'Beta 2', isPublic: false } })
    )
    expect(renamed.data).toMatchObject({ name: 'Beta 2', isPublic: false })

    const list = await call('projects/[slug]/products/index.get', eventFor(ids.member, { params }))
    expect(list.data.map((p: any) => p.slug)).toEqual(['alpha-brand', 'beta'])
    const defaultProduct = list.data[0]

    const [proj] = await db.select().from(project).where(eq(project.slug, 'alpha-brand'))
    await db.insert(feedback).values({
      id: `pp_fb_${suffix}`,
      projectId: proj!.id,
      productId: beta.data.id,
      title: 'Something',
      authorUserId: ids.member,
    })

    const deleteParams = { ...params, productId: beta.data.id }
    await expectStatus(
      call('projects/[slug]/products/[productId].delete', eventFor(ids.owner, { params: deleteParams })),
      409
    )
    await expectStatus(
      call(
        'projects/[slug]/products/[productId].delete',
        eventFor(ids.owner, { params: deleteParams, query: { moveTo: beta.data.id } })
      ),
      400
    )

    const deleted = await call(
      'projects/[slug]/products/[productId].delete',
      eventFor(ids.owner, { params: deleteParams, query: { moveTo: defaultProduct.id } })
    )
    expect(deleted.data).toMatchObject({ deleted: true, movedFeedback: 1 })
    const [moved] = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, `pp_fb_${suffix}`))
    expect(moved?.productId).toBe(defaultProduct.id)

    // Last remaining product cannot be deleted
    await expectStatus(
      call(
        'projects/[slug]/products/[productId].delete',
        eventFor(ids.owner, { params: { ...params, productId: defaultProduct.id } })
      ),
      409
    )
  })

  it('deletes a project that still has feedback (org admins only)', async () => {
    const params = { slug: 'alpha-brand' }
    await expectStatus(call('projects/[slug].delete', eventFor(ids.member, { params })), 403)
    const res = await call('projects/[slug].delete', eventFor(ids.owner, { params }))
    expect(res.data.deleted).toBe(true)
    expect(await db.select().from(project).where(eq(project.slug, 'alpha-brand'))).toHaveLength(
      // the auto-suffixed twin (alpha-brand-2) is a different slug
      0
    )
  })
})
