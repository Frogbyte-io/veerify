import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The inbox address API against a real database: catch-all validation,
 * domain and product links, the workspace address limit, PATCH (including
 * moving between inboxes), and the `mail:set-tier` operator script.
 *
 * Authentication and inbox roles are stubbed (they have their own suites):
 * the caller administers every inbox, except those listed in `state.forbidden`.
 */

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  body: {} as unknown,
  forbidden: new Set<string>(),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
// A request may carry its own params and body (for concurrent calls); otherwise `state` is used.
type FakeEvent = { params?: Record<string, string>; body?: unknown } | undefined
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => (event?.params ?? state.params)[name])
vi.stubGlobal('readBody', async (event: FakeEvent) => (event?.body !== undefined ? event.body : state.body))
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('~/server/utils/support-access', async () => {
  const { db } = await import('../../server/database/drizzle')
  const { supportInbox } = await import('../../server/database/schema/support')
  const { eq } = await import('drizzle-orm')
  const requireInboxRole = async (inboxId: string) => {
    const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, inboxId)).limit(1)
    if (!inbox) throw Object.assign(new Error('Not Found'), { statusCode: 404 })
    if (state.forbidden.has(inboxId)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { ...inbox, effectiveRole: 'admin', isProjectAdmin: true }
  }
  return { requireInboxRole, requireInboxAccess: requireInboxRole }
})
// Mailgun routes by envelope recipient: unclaimed domains stay allowed (design §9.3).
vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'mailgun')

const { db } = await import('../../server/database/drizzle')
const { organization } = await import('../../server/database/schema/auth')
const { product, project } = await import('../../server/database/schema/feedback')
const { projectMailAddress, projectMailDomain, supportInbox } = await import('../../server/database/schema/support')
const { mailEntitlement } = await import('../../server/database/schema/mail')
const createAddress = (await import('../../server/api/support/inboxes/[id]/addresses/index.post')).default
const listAddresses = (await import('../../server/api/support/inboxes/[id]/addresses/index.get')).default
const updateAddress = (await import('../../server/api/support/inboxes/[id]/addresses/[addressId].patch')).default
const { setMailTier, MailTierScriptError } = await import('../../scripts/mail-set-tier')

type Handler = (event: never) => Promise<{ data: Record<string, any> }>
const call = (handler: unknown, params: Record<string, string>, body?: unknown) => {
  state.params = params
  state.body = body
  return (handler as Handler)({} as never)
}

async function rejection(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { code?: string; error?: { code?: string } } } | null
  expect(error, 'expected a rejection').not.toBeNull()
  return { statusCode: error?.statusCode, code: error?.data?.error?.code ?? error?.data?.code }
}

const runId = randomUUID().slice(0, 8)
const orgId = `org_addrapi_${runId}`
const orgSlug = `addrapi-${runId}`
const projectA = `project_addrapi_a_${runId}`
const projectB = `project_addrapi_b_${runId}`
const inboxA1 = `inbox_addrapi_a1_${runId}`
const inboxA2 = `inbox_addrapi_a2_${runId}`
const inboxB = `inbox_addrapi_b_${runId}`
const productA = `product_addrapi_a_${runId}`
const productB = `product_addrapi_b_${runId}`
const domain = `addrapi-${runId}.example.test`
const domainId = `domain_addrapi_${runId}`
const now = new Date()

beforeAll(async () => {
  await db.insert(organization).values({ id: orgId, name: 'Address API Org', slug: orgSlug })
  await db.insert(project).values([
    { id: projectA, name: 'A', slug: `addrapi-a-${runId}`, organizationId: orgId },
    { id: projectB, name: 'B', slug: `addrapi-b-${runId}`, organizationId: orgId },
  ])
  await db.insert(product).values([
    { id: productA, projectId: projectA, name: 'Product A', slug: `pa-${runId}` },
    { id: productB, projectId: projectB, name: 'Product B', slug: `pb-${runId}` },
  ])
  await db.insert(supportInbox).values([
    { id: inboxA1, projectId: projectA, name: 'A1', slug: `a1-${runId}`, createdAt: now, updatedAt: now },
    { id: inboxA2, projectId: projectA, name: 'A2', slug: `a2-${runId}`, createdAt: now, updatedAt: now },
    { id: inboxB, projectId: projectB, name: 'B', slug: `b-${runId}`, createdAt: now, updatedAt: now },
  ])
  await db.insert(projectMailDomain).values({
    id: domainId,
    projectId: projectA,
    domain,
    registrableDomain: domain,
    status: 'pending',
    provider: 'mailgun',
    ownershipToken: 'tok',
  })
})

beforeEach(async () => {
  state.forbidden.clear()
  await db.delete(projectMailAddress).where(inArray(projectMailAddress.projectId, [projectA, projectB]))
  await db.delete(mailEntitlement).where(eq(mailEntitlement.organizationId, orgId))
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, orgId))
})

describe('POST /api/support/inboxes/[id]/addresses', () => {
  it('creates a catch-all on a project mail domain (pending is enough), linked to the domain', async () => {
    const res = await call(createAddress, { id: inboxA1 }, { address: `*@${domain.toUpperCase()}` })
    expect(res.data.address).toMatchObject({
      address: `*@${domain}`,
      isCatchAll: true,
      domainId,
      behaviour: 'helpdesk',
      productId: null,
      kind: 'custom',
      inboxId: inboxA1,
    })
  })

  it('refuses a catch-all on a domain the project has not connected with 422 CATCH_ALL_DOMAIN_REQUIRED', async () => {
    expect(await rejection(call(createAddress, { id: inboxA1 }, { address: '*@elsewhere.example.test' }))).toEqual({
      statusCode: 422,
      code: 'CATCH_ALL_DOMAIN_REQUIRED',
    })
    // Another project's domain is refused before the catch-all rule even runs.
    expect(await rejection(call(createAddress, { id: inboxB }, { address: `*@${domain}` }))).toEqual({
      statusCode: 409,
      code: 'ADDRESS_DOMAIN_CLAIMED',
    })
  })

  it('refuses a catch-all on a domain being deleted', async () => {
    await db.update(projectMailDomain).set({ status: 'deleting' }).where(eq(projectMailDomain.id, domainId))
    try {
      expect(await rejection(call(createAddress, { id: inboxA1 }, { address: `*@${domain}` }))).toEqual({
        statusCode: 422,
        code: 'CATCH_ALL_DOMAIN_REQUIRED',
      })
    } finally {
      await db.update(projectMailDomain).set({ status: 'pending' }).where(eq(projectMailDomain.id, domainId))
    }
  })

  it.each(['a*@x.example.test', '*.*@x.example.test', '*@', 'nope'])('rejects %j with 400', async (address) => {
    expect(await rejection(call(createAddress, { id: inboxA1 }, { address }))).toMatchObject({ statusCode: 400 })
  })

  it('allows one catch-all per domain', async () => {
    await call(createAddress, { id: inboxA1 }, { address: `*@${domain}` })
    expect(await rejection(call(createAddress, { id: inboxA2 }, { address: `*@${domain}` }))).toMatchObject({
      statusCode: 409,
    })
  })

  it('stores behaviour and product, and links exact addresses to their domain only when it matches exactly', async () => {
    const onDomain = await call(
      createAddress,
      { id: inboxA1 },
      { address: `hello@${domain}`, behaviour: 'mail', productId: productA }
    )
    expect(onDomain.data.address).toMatchObject({ domainId, behaviour: 'mail', productId: productA, isCatchAll: false })

    const sub = await call(createAddress, { id: inboxA1 }, { address: `hello@sub.${domain}` })
    expect(sub.data.address.domainId).toBeNull()

    expect(
      await rejection(call(createAddress, { id: inboxA1 }, { address: `x@${domain}`, productId: productB }))
    ).toEqual({ statusCode: 422, code: 'PRODUCT_NOT_IN_PROJECT' })
    expect(
      await rejection(call(createAddress, { id: inboxA1 }, { address: `x@${domain}`, behaviour: 'loud' }))
    ).toMatchObject({ statusCode: 400 })
  })

  it('enforces the workspace address limit across projects; platform addresses do not count', async () => {
    // Standard: 20 custom addresses per workspace. 19 already, over two projects.
    await db.insert(projectMailAddress).values([
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `fill_a_${i}_${runId}`,
        inboxId: inboxA1,
        projectId: projectA,
        address: `fill${i}@a-${runId}.example.test`,
      })),
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `fill_b_${i}_${runId}`,
        inboxId: inboxB,
        projectId: projectB,
        address: `fill${i}@b-${runId}.example.test`,
      })),
      { id: `platform_${runId}`, inboxId: inboxB, projectId: projectB, address: `p-${runId}@x.test`, kind: 'platform' },
    ])

    await expect(call(createAddress, { id: inboxB }, { address: `twenty@${runId}.example.test` })).resolves.toBeTruthy()
    expect(await rejection(call(createAddress, { id: inboxA1 }, { address: `*@${domain}` }))).toEqual({
      statusCode: 409,
      code: 'MAIL_ADDRESS_LIMIT_REACHED',
    })

    // The owner tier lifts it.
    await setMailTier({ slug: orgSlug, tier: 'owner', actor: 'script:test' })
    await expect(call(createAddress, { id: inboxA1 }, { address: `*@${domain}` })).resolves.toBeTruthy()
  })

  it('cannot exceed the address limit by racing', async () => {
    await db.insert(projectMailAddress).values(
      Array.from({ length: 18 }, (_, i) => ({
        id: `race_fill_${i}_${runId}`,
        inboxId: inboxA1,
        projectId: projectA,
        address: `race-fill${i}@a-${runId}.example.test`,
      }))
    )
    // 18 used: six concurrent creates in two projects, exactly two may win.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        (createAddress as unknown as (event: FakeEvent) => Promise<unknown>)({
          params: { id: i % 2 ? inboxA2 : inboxB },
          body: { address: `race${i}@r-${runId}.example.test` },
        })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    for (const rejected of results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')) {
      expect(rejected.reason.data.code).toBe('MAIL_ADDRESS_LIMIT_REACHED')
    }
    const rows = await db
      .select({ id: projectMailAddress.id })
      .from(projectMailAddress)
      .where(inArray(projectMailAddress.projectId, [projectA, projectB]))
    expect(rows).toHaveLength(20)
  })
})

describe('GET /api/support/inboxes/[id]/addresses', () => {
  it('returns the new fields', async () => {
    await call(createAddress, { id: inboxA1 }, { address: `*@${domain}`, behaviour: 'mail', productId: productA })
    const res = await call(listAddresses, { id: inboxA1 })
    expect(res.data.addresses).toEqual([
      expect.objectContaining({ isCatchAll: true, behaviour: 'mail', productId: productA, domainId }),
    ])
  })
})

describe('PATCH /api/support/inboxes/[id]/addresses/[addressId]', () => {
  async function seed() {
    const primary = (await call(createAddress, { id: inboxA1 }, { address: `one@${domain}`, isPrimary: true })).data
      .address
    const other = (await call(createAddress, { id: inboxA1 }, { address: `two@${domain}` })).data.address
    return { primary, other }
  }

  it('changes behaviour and product, and clears the product with null', async () => {
    const { other } = await seed()
    const res = await call(
      updateAddress,
      { id: inboxA1, addressId: other.id },
      { behaviour: 'mail', productId: productA }
    )
    expect(res.data.address).toMatchObject({ behaviour: 'mail', productId: productA })
    const cleared = await call(updateAddress, { id: inboxA1, addressId: other.id }, { productId: null })
    expect(cleared.data.address).toMatchObject({ behaviour: 'mail', productId: null })
    expect(await rejection(call(updateAddress, { id: inboxA1, addressId: other.id }, { productId: productB }))).toEqual(
      { statusCode: 422, code: 'PRODUCT_NOT_IN_PROJECT' }
    )
  })

  it('keeps isPrimary exclusive within the inbox', async () => {
    const { primary, other } = await seed()
    await call(updateAddress, { id: inboxA1, addressId: other.id }, { isPrimary: true })
    const rows = await db.select().from(projectMailAddress).where(eq(projectMailAddress.inboxId, inboxA1))
    expect(rows.find((r) => r.id === other.id)?.isPrimary).toBe(true)
    expect(rows.find((r) => r.id === primary.id)?.isPrimary).toBe(false)
  })

  it('moves an address to another inbox of the project, keeping its route and dropping primary', async () => {
    const { primary } = await seed()
    await db
      .update(projectMailAddress)
      .set({ providerRouteId: 'route-1', providerRouteStatus: 'active' })
      .where(eq(projectMailAddress.id, primary.id))

    const res = await call(updateAddress, { id: inboxA1, addressId: primary.id }, { inboxId: inboxA2 })
    expect(res.data.address).toMatchObject({
      inboxId: inboxA2,
      isPrimary: false,
      providerRouteId: 'route-1',
      providerRouteStatus: 'active',
    })
    // It is no longer on the source inbox.
    expect(await rejection(call(updateAddress, { id: inboxA1, addressId: primary.id }, { behaviour: 'mail' }))).toEqual(
      { statusCode: 404, code: 'NOT_FOUND' }
    )
  })

  it('refuses moves to another project, to an inbox the caller does not administer, and of platform addresses', async () => {
    const { other } = await seed()
    expect(await rejection(call(updateAddress, { id: inboxA1, addressId: other.id }, { inboxId: inboxB }))).toEqual({
      statusCode: 422,
      code: 'INBOX_NOT_IN_PROJECT',
    })

    state.forbidden.add(inboxA2)
    expect(
      await rejection(call(updateAddress, { id: inboxA1, addressId: other.id }, { inboxId: inboxA2 }))
    ).toMatchObject({ statusCode: 403 })
    state.forbidden.clear()

    await db.insert(projectMailAddress).values({
      id: `platform_move_${runId}`,
      inboxId: inboxA1,
      projectId: projectA,
      address: `pm-${runId}@platform.test`,
      kind: 'platform',
    })
    expect(
      await rejection(call(updateAddress, { id: inboxA1, addressId: `platform_move_${runId}` }, { inboxId: inboxA2 }))
    ).toEqual({ statusCode: 409, code: 'PLATFORM_ADDRESS_IMMOVABLE' })
    const row = await db
      .select({ inboxId: projectMailAddress.inboxId })
      .from(projectMailAddress)
      .where(eq(projectMailAddress.id, other.id))
    expect(row[0].inboxId).toBe(inboxA1)
  })
})

describe('yarn mail:set-tier', () => {
  it('upserts the entitlement, records the actor and reports the usage', async () => {
    const first = await setMailTier({ slug: orgSlug.toUpperCase(), tier: 'owner', actor: 'script:alice' })
    expect(first).toMatchObject({
      organization: { id: orgId, slug: orgSlug },
      previousTier: 'standard',
      hadEntitlement: false,
      tier: 'owner',
      updatedBy: 'script:alice',
      usage: { tier: 'owner', limits: { domains: 69, addresses: 420 }, used: { domains: 1, pendingDomains: 1 } },
    })

    const second = await setMailTier({ slug: orgSlug, tier: 'standard', actor: 'script:bob' })
    expect(second).toMatchObject({ previousTier: 'owner', hadEntitlement: true, tier: 'standard' })
    const rows = await db.select().from(mailEntitlement).where(eq(mailEntitlement.organizationId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tier: 'standard', updatedBy: 'script:bob' })
  })

  it('refuses an unknown tier or workspace and writes nothing', async () => {
    await expect(setMailTier({ slug: orgSlug, tier: 'platinum' })).rejects.toBeInstanceOf(MailTierScriptError)
    await expect(setMailTier({ slug: `missing-${runId}`, tier: 'owner' })).rejects.toBeInstanceOf(MailTierScriptError)
    const rows = await db.select().from(mailEntitlement).where(eq(mailEntitlement.organizationId, orgId))
    expect(rows).toHaveLength(0)
  })
})
