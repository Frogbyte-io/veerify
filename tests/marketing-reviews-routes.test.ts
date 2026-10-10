import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  query: {} as Record<string, unknown>,
  body: {} as unknown,
  selectQueue: [] as unknown[][],
  selectedFields: [] as Array<Record<string, unknown> | null>,
  wheres: [] as unknown[],
  inserts: [] as Array<{ values: unknown; conflict: boolean }>,
  updates: [] as Array<{ set: unknown; where: unknown }>,
  updateRows: [] as unknown[],
  deleteRows: [] as unknown[],
  deleteWhere: null as unknown,
  redirect: null as { url: string; code: number } | null,
  headers: {} as Record<string, string>,
  access: 'ok' as 'ok' | 'forbidden',
  admin: 'ok' as 'ok' | 'forbidden',
  rateLimitKeys: [] as string[],
  rateLimitConfigs: [] as Array<Record<string, unknown>>,
  teamAdmin: true,
  enqueue: [] as unknown[],
  marketingOn: true,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('setHeader', (_e: unknown, name: string, value: string) => void (state.headers[name] = value))
vi.stubGlobal('sendRedirect', (_e: unknown, url: string, code: number) => {
  state.redirect = { url, code }
  return url
})
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (state.access === 'forbidden') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { project: {}, teamId: 't1' }
  }),
  requireMarketingAdmin: vi.fn(async () => {
    if (state.access === 'forbidden' || state.admin === 'forbidden') {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    }
    return { project: {}, teamId: 't1' }
  }),
}))

vi.mock('~/server/utils/rate-limit', () => ({
  rateLimits: { strict: { maxRequests: 5, windowSeconds: 60 }, relaxed: { maxRequests: 100, windowSeconds: 60 } },
  requireRateLimit: vi.fn(async (_e: unknown, config: { identifier?: string }) => {
    state.rateLimitConfigs.push(config)
    state.rateLimitKeys.push(config.identifier ?? '')
  }),
}))

vi.mock('~/server/utils/project-access', () => ({
  resolvePublicProjectByTeam: vi.fn(async () => ({ team: { id: 't1' }, project: { id: 'p1' } })),
}))

vi.mock('~/server/utils/public-modules', () => ({
  isModuleEnabledForProject: vi.fn(async () => state.marketingOn),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async () => {
    if (!state.teamAdmin) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { role: 'admin' }
  }),
}))

vi.mock('~/server/services/marketing/reviews/service', () => ({
  enqueueManualReviewRequests: vi.fn(async (input: { projectId: string; emails: string[] }) => {
    state.enqueue.push(input)
    return input.emails.map((email) =>
      email.startsWith('skip') ? { email, queued: false, reason: 'cooldown' } : { email, queued: true }
    )
  }),
}))

vi.mock('~/server/database/drizzle', () => {
  const makeChain = (fields: Record<string, unknown> | null) => {
    state.selectedFields.push(fields)
    const chain: Record<string, any> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (condition: unknown) => {
        state.wheres.push(condition)
        return chain
      },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => resolve(state.selectQueue.shift() ?? []),
    }
    return chain
  }
  const insert = () => ({
    values: (values: unknown) => {
      const record = { values, conflict: false }
      state.inserts.push(record)
      const result: Record<string, any> = {
        onConflictDoNothing: () => {
          record.conflict = true
          return result
        },
        onConflictDoUpdate: () => {
          record.conflict = true
          return result
        },
        returning: async () => [{ projectId: 'p1', ...(values as object) }],
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }
      return result
    },
  })
  const db: Record<string, any> = {
    select: vi.fn((fields?: Record<string, unknown>) => makeChain(fields ?? null)),
    insert: vi.fn(insert),
    update: vi.fn(() => ({
      set: (set: unknown) => ({
        where: (where: unknown) => {
          state.updates.push({ set, where })
          return { returning: async () => state.updateRows }
        },
      }),
    })),
    delete: vi.fn(() => ({
      where: (where: unknown) => {
        state.deleteWhere = where
        return { returning: async () => state.deleteRows }
      },
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  }
  return { db }
})

const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never)

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

const publicInfo = (await import('~/server/api/marketing/r/[token]/index.get')).default
const goHandler = (await import('~/server/api/marketing/r/[token]/go.get')).default
const unsubGet = (await import('~/server/api/marketing/r/[token]/unsubscribe.get')).default
const unsubPost = (await import('~/server/api/marketing/r/[token]/unsubscribe.post')).default
const submitHandler = (await import('~/server/api/marketing/r/[token]/testimonial.post')).default
const publicWall = (await import('~/server/api/public/t/[teamSlug]/[projectSlug]/testimonials.get')).default
const patchHandler = (await import('~/server/api/marketing/projects/[projectId]/testimonials/[id].patch')).default
const deleteHandler = (await import('~/server/api/marketing/projects/[projectId]/testimonials/[id].delete')).default
const settingsPut = (await import('~/server/api/marketing/projects/[projectId]/reviews/settings.put')).default
const requestsPost = (await import('~/server/api/marketing/projects/[projectId]/reviews/requests.post')).default
const requestsGet = (await import('~/server/api/marketing/projects/[projectId]/reviews/requests.get')).default
const testimonialsGet = (await import('~/server/api/marketing/projects/[projectId]/testimonials/index.get')).default

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rr-1',
  projectId: 'p1',
  teamId: 'team-1',
  email: 'Jane@Example.com',
  name: 'Jane Doe',
  clickedAt: null,
  status: 'sent',
  sentAt: new Date(),
  createdAt: new Date(),
  projectName: 'Acme',
  projectSettings: { marketingEnabled: true },
  teamMarketingEnabled: true,
  platforms: [{ id: 'g2', label: 'G2', url: 'https://www.g2.com/products/acme/reviews' }],
  askForTestimonial: true,
  requestsEnabled: true,
  ...overrides,
})

const DAY = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY)

/** The row the testimonial POST selects (request + product + settings), sent and fresh by default. */
const submitRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rr-1',
  projectId: 'p1',
  email: 'jane@example.com',
  status: 'sent',
  sentAt: daysAgo(1),
  createdAt: daysAgo(1),
  projectSettings: { marketingEnabled: true },
  teamMarketingEnabled: true,
  requestsEnabled: true,
  askForTestimonial: true,
  ...overrides,
})

beforeEach(() => {
  state.params = { token: TOKEN, projectId: 'p1', id: 't1', teamSlug: 'acme', projectSlug: 'app' }
  state.query = {}
  state.body = {}
  state.selectQueue = []
  state.selectedFields = []
  state.wheres = []
  state.inserts = []
  state.updates = []
  state.updateRows = []
  state.deleteRows = []
  state.deleteWhere = null
  state.redirect = null
  state.headers = {}
  state.access = 'ok'
  state.marketingOn = true
  state.admin = 'ok'
  state.rateLimitKeys = []
  state.rateLimitConfigs = []
  state.teamAdmin = true
  state.enqueue = []
})

describe('GET /api/marketing/r/[token]', () => {
  it('returns product name, first name and submitted flag only', async () => {
    state.selectQueue = [[requestRow()], []]
    const response = (await publicInfo({} as never)) as { data: Record<string, unknown> }
    expect(response.data).toEqual({ productName: 'Acme', firstName: 'Jane', alreadySubmitted: false, canSubmit: true })
    expect(JSON.stringify(response)).not.toContain('example.com')
  })

  it('reports an existing submission', async () => {
    state.selectQueue = [[requestRow()], [{ id: 't1' }]]
    const response = (await publicInfo({} as never)) as { data: { alreadySubmitted: boolean } }
    expect(response.data.alreadySubmitted).toBe(true)
  })

  it('404s for unknown and malformed tokens', async () => {
    state.selectQueue = [[]]
    await expect(publicInfo({} as never)).rejects.toMatchObject({ statusCode: 404 })
    state.params.token = 'short'
    await expect(publicInfo({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/marketing/r/[token]/go (open redirect protection)', () => {
  it('redirects to the configured platform url and records the click', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[requestRow()]]
    await goHandler({} as never)
    expect(state.redirect).toEqual({ url: 'https://www.g2.com/products/acme/reviews', code: 302 })
    expect(state.updates).toHaveLength(1)
    expect((state.updates[0].set as { clickedAt: Date }).clickedAt).toBeInstanceOf(Date)
  })

  it('does not rewrite clickedAt on repeat clicks', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[requestRow({ clickedAt: new Date() })]]
    await goHandler({} as never)
    expect(state.updates).toHaveLength(0)
    expect(state.redirect?.code).toBe(302)
  })

  it('never redirects to a url taken from the request', async () => {
    for (const p of ['https://evil.example/phish', '//evil.example', 'unknown']) {
      state.query = { p }
      state.selectQueue = [[requestRow()]]
      await expect(goHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    }
    expect(state.redirect).toBeNull()
  })

  it('refuses a configured url that is not https', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[requestRow({ platforms: [{ id: 'g2', label: 'G2', url: 'javascript:alert(1)' }] })]]
    await expect(goHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.redirect).toBeNull()
  })

  it('404s for an unknown token or a missing platform id', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[]]
    await expect(goHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    state.query = {}
    state.selectQueue = [[requestRow()]]
    await expect(goHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('unsubscribe', () => {
  it('GET only shows a confirmation page and writes nothing', async () => {
    state.selectQueue = [[requestRow({ projectName: '<b>Acme</b>' })]]
    const html = (await unsubGet({} as never)) as string
    expect(html).toContain('<form method="post">')
    expect(html).not.toContain('<b>Acme</b>')
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;')
    expect(state.inserts).toHaveLength(0)
  })

  it('POST writes a per-team suppression for the lower-cased address', async () => {
    state.selectQueue = [[requestRow()]]
    const html = (await unsubPost({} as never)) as string
    expect(html).toContain('You are unsubscribed')
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0].values).toEqual({ teamId: 'team-1', email: 'jane@example.com', reason: 'unsubscribed' })
    expect(state.inserts[0].conflict).toBe(true)
  })

  it('POST 404s for an unknown token without writing', async () => {
    state.selectQueue = [[]]
    await expect(unsubPost({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.inserts).toHaveLength(0)
  })
})

describe('POST /api/marketing/r/[token]/testimonial', () => {
  const valid = {
    authorName: 'Jane Doe',
    authorTitle: 'CTO',
    authorCompany: 'Acme',
    quote: 'This product changed the way our team works every day.',
    rating: 5,
    consentPublic: false,
  }

  it('stores a pending testimonial, keeping consent as submitted and the email private', async () => {
    state.body = valid
    state.selectQueue = [[submitRow()], []]
    await submitHandler({} as never)
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0].values).toMatchObject({
      projectId: 'p1',
      reviewRequestId: 'rr-1',
      status: 'pending',
      consentPublic: false,
      authorEmail: 'jane@example.com',
      rating: 5,
    })
  })

  it('rate limits per token (the limiter adds the client ip)', async () => {
    state.body = valid
    state.selectQueue = [[submitRow({ email: 'a@b.co' })], []]
    await submitHandler({} as never)
    expect(state.rateLimitKeys[0]).toBe(`public-testimonial:${TOKEN}`)
  })

  it('allows only one testimonial per token', async () => {
    state.body = valid
    state.selectQueue = [[submitRow({ email: 'a@b.co' })], [{ id: 'existing' }]]
    await expect(submitHandler({} as never)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.inserts).toHaveLength(0)
  })

  it('404s for an unknown token', async () => {
    state.body = valid
    state.selectQueue = [[]]
    await expect(submitHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    ['short quote', { quote: 'too short' }],
    ['long quote', { quote: 'x'.repeat(1001) }],
    ['missing name', { authorName: '  ' }],
    ['long name', { authorName: 'n'.repeat(81) }],
    ['long title', { authorTitle: 't'.repeat(81) }],
    ['long company', { authorCompany: 'c'.repeat(81) }],
    ['rating 0', { rating: 0 }],
    ['rating 6', { rating: 6 }],
    ['missing consent', { consentPublic: undefined }],
  ])('rejects %s', async (_label, patch) => {
    state.body = { ...valid, ...patch }
    await expect(submitHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserts).toHaveLength(0)
  })

  it('treats rating, title and company as optional', async () => {
    state.body = { authorName: 'J', quote: valid.quote, consentPublic: true }
    state.selectQueue = [[submitRow({ email: 'a@b.co' })], []]
    await submitHandler({} as never)
    expect(state.inserts[0].values).toMatchObject({ rating: null, authorTitle: null, authorCompany: null })
  })
})

describe('GET public testimonial wall', () => {
  it('only returns approved, consented testimonials, featured first, without private fields', async () => {
    state.selectQueue = [[{ id: 't1', authorName: 'Jane' }]]
    const response = (await publicWall({} as never)) as { data: { items: unknown[] } }
    expect(response.data.items).toHaveLength(1)

    const { sql, params } = sqlOf(state.wheres[0])
    expect(sql).toContain('"testimonial"."project_id"')
    expect(sql).toContain('"testimonial"."status"')
    expect(sql).toContain('"testimonial"."consent_public"')
    expect(params).toEqual(expect.arrayContaining(['p1', 'approved', true]))

    const fields = Object.keys(state.selectedFields[0] ?? {})
    expect(fields.sort()).toEqual(
      ['authorCompany', 'authorName', 'authorTitle', 'createdAt', 'id', 'quote', 'rating'].sort()
    )
    expect(fields).not.toContain('authorEmail')
  })
})

describe('GET public testimonial wall: Marketing toggle', () => {
  it('404s without reading testimonials when Marketing is off for the team or product', async () => {
    state.marketingOn = false
    state.selectQueue = [[{ id: 't1', authorName: 'Jane' }]]
    await expect(publicWall({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.wheres).toHaveLength(0)
  })
})

describe('moderation routes', () => {
  it('scopes the testimonial lookup and update to the product (cross-project protection)', async () => {
    state.body = { status: 'approved' }
    state.selectQueue = [[{ id: 't1', consentPublic: true, status: 'pending' }]]
    state.updateRows = [{ id: 't1', status: 'approved', featured: false, consentPublic: true }]
    await patchHandler({} as never)
    for (const condition of [state.wheres[0], state.updates[0].where]) {
      const { sql, params } = sqlOf(condition)
      expect(sql).toContain('"testimonial"."project_id"')
      expect(params).toEqual(expect.arrayContaining(['t1', 'p1']))
    }
    expect((state.updates[0].set as { moderatedByUserId: string }).moderatedByUserId).toBe('u1')
  })

  it('404s when the testimonial belongs to another product', async () => {
    state.body = { status: 'approved' }
    state.selectQueue = [[]]
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.updates).toHaveLength(0)
  })

  it('refuses to feature a testimonial without public consent', async () => {
    state.body = { status: 'approved', featured: true }
    state.selectQueue = [[{ id: 't1', consentPublic: false, status: 'pending' }]]
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.updates).toHaveLength(0)
  })

  it('refuses to feature a testimonial that is not approved', async () => {
    state.body = { featured: true }
    state.selectQueue = [[{ id: 't1', consentPublic: true, status: 'pending' }]]
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('clears the featured flag when a testimonial leaves the approved state', async () => {
    state.body = { status: 'rejected' }
    state.selectQueue = [[{ id: 't1', consentPublic: true, status: 'approved' }]]
    state.updateRows = [{ id: 't1', status: 'rejected', featured: false, consentPublic: true }]
    await patchHandler({} as never)
    expect(state.updates[0].set).toMatchObject({ status: 'rejected', featured: false })
  })

  it('delete is scoped by product and 404s otherwise', async () => {
    state.deleteRows = []
    await expect(deleteHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    const { sql } = sqlOf(state.deleteWhere)
    expect(sql).toContain('"testimonial"."project_id"')
    state.deleteRows = [{ id: 't1' }]
    await expect(deleteHandler({} as never)).resolves.toMatchObject({ data: { id: 't1' } })
  })

  it('requires marketing access to list, moderate and delete', async () => {
    state.access = 'forbidden'
    state.body = { status: 'approved' }
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 403 })
    await expect(deleteHandler({} as never)).rejects.toMatchObject({ statusCode: 403 })
    await expect(testimonialsGet({} as never)).rejects.toMatchObject({ statusCode: 403 })
    await expect(requestsGet({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('scopes the testimonial list to the product', async () => {
    state.selectQueue = [[], []]
    await testimonialsGet({} as never)
    expect(sqlOf(state.wheres[0]).sql).toContain('"testimonial"."project_id"')
  })

  it('never returns the request token in the requests log', async () => {
    state.selectQueue = [[]]
    await requestsGet({} as never)
    expect(Object.keys(state.selectedFields[0] ?? {})).not.toContain('token')
    expect(sqlOf(state.wheres[0]).sql).toContain('"review_request"."project_id"')
  })
})

describe('PUT reviews settings', () => {
  const validBody = () => ({
    enabled: true,
    platforms: [{ label: 'G2', url: 'https://www.g2.com/products/acme/reviews' }],
    askForTestimonial: true,
    csatTrigger: true,
    csatMinRating: null,
    shippedTrigger: true,
    shippedStatusValues: ['completed'],
    cooldownDays: 90,
  })

  it('saves valid settings and assigns stable platform ids', async () => {
    state.body = validBody()
    state.selectQueue = [[]] // no custom statuses: system statuses apply
    await settingsPut({} as never)
    expect(state.inserts).toHaveLength(1)
    const values = state.inserts[0].values as { platforms: Array<{ id: string }>; projectId: string }
    expect(values.projectId).toBe('p1')
    expect(values.platforms[0].id).toMatch(/^[a-z0-9-]+$/)
  })

  it('is admin only', async () => {
    state.admin = 'forbidden'
    state.body = validBody()
    await expect(settingsPut({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserts).toHaveLength(0)
  })

  it.each([
    ['seven platforms', { platforms: Array.from({ length: 7 }, (_, i) => ({ label: `P${i}`, url: 'https://a.co' })) }],
    ['http url', { platforms: [{ label: 'G2', url: 'http://g2.com' }] }],
    ['javascript url', { platforms: [{ label: 'G2', url: 'javascript:alert(1)' }] }],
    ['long label', { platforms: [{ label: 'x'.repeat(41), url: 'https://g2.com' }] }],
    ['empty label', { platforms: [{ label: '', url: 'https://g2.com' }] }],
    ['cooldown 0', { cooldownDays: 0 }],
    ['enabled with nothing to send', { platforms: [], askForTestimonial: false }],
  ])('rejects %s', async (_label, patch) => {
    state.body = { ...validBody(), ...patch }
    state.selectQueue = [[]]
    await expect(settingsPut({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects shipped statuses that do not exist for the product', async () => {
    state.body = { ...validBody(), shippedStatusValues: ['completed', 'launched'] }
    state.selectQueue = [
      [
        { value: 'open', name: 'Open' },
        { value: 'completed', name: 'Done' },
      ],
    ]
    await expect(settingsPut({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserts).toHaveLength(0)
  })

  it('accepts custom statuses', async () => {
    state.body = { ...validBody(), shippedStatusValues: ['launched'] }
    state.selectQueue = [[{ value: 'launched', name: 'Launched' }]]
    await settingsPut({} as never)
    expect(state.inserts).toHaveLength(1)
  })
})

describe('POST manual review requests', () => {
  it('passes the addresses to the manual queue and reports per-address results', async () => {
    state.body = { emails: ['a@x.io', 'skip@x.io'] }
    const response = (await requestsPost({} as never)) as {
      data: { queued: number; results: Array<{ email: string; queued: boolean; reason?: string }> }
    }
    expect(response.data.queued).toBe(1)
    expect(response.data.results).toEqual([
      { email: 'a@x.io', queued: true },
      { email: 'skip@x.io', queued: false, reason: 'cooldown' },
    ])
    expect(state.enqueue[0]).toMatchObject({ projectId: 'p1', emails: ['a@x.io', 'skip@x.io'] })
  })

  it('leaves malformed addresses to the per-address results instead of failing the batch', async () => {
    state.body = { emails: ['a@x.io', 'nope'] }
    const response = (await requestsPost({} as never)) as { data: { results: unknown[] } }
    expect(response.data.results).toHaveLength(2)
    expect(state.enqueue).toHaveLength(1)
  })

  it('rate limits to 10 calls per hour per product', async () => {
    state.body = { emails: ['a@x.io'] }
    await requestsPost({} as never)
    expect(state.rateLimitConfigs[0]).toMatchObject({ maxRequests: 10, windowSeconds: 3600, subject: 'p1' })
  })

  it('is rejected with 429 when the limiter refuses', async () => {
    const { requireRateLimit } = await import('~/server/utils/rate-limit')
    vi.mocked(requireRateLimit).mockRejectedValueOnce(Object.assign(new Error('Too Many'), { statusCode: 429 }))
    state.body = { emails: ['a@x.io'] }
    await expect(requestsPost({} as never)).rejects.toMatchObject({ statusCode: 429 })
    expect(state.enqueue).toHaveLength(0)
  })

  it('accepts at most 20 addresses', async () => {
    state.body = { emails: Array.from({ length: 21 }, (_, i) => `u${i}@x.io`) }
    await expect(requestsPost({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.enqueue).toHaveLength(0)
  })

  it('rejects empty lists and non-admins', async () => {
    state.body = { emails: [] }
    await expect(requestsPost({} as never)).rejects.toMatchObject({ statusCode: 400 })
    state.body = { emails: ['a@x.io'] }
    state.admin = 'forbidden'
    await expect(requestsPost({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.enqueue).toHaveLength(0)
  })
})

describe('testimonial POST guards', () => {
  const valid = {
    authorName: 'Jane Doe',
    quote: 'This product changed the way our team works every day.',
    consentPublic: false,
  }

  beforeEach(() => {
    state.body = valid
  })

  it.each([
    ['queued', { status: 'queued' }],
    ['skipped', { status: 'skipped' }],
    ['failed', { status: 'failed' }],
    ['sending', { status: 'sending' }],
    ['requests disabled', { requestsEnabled: false }],
    ['no settings row', { requestsEnabled: null, askForTestimonial: null }],
    ['testimonial ask off', { askForTestimonial: false }],
    ['team marketing off', { teamMarketingEnabled: false }],
    ['product marketing off', { projectSettings: { marketingEnabled: false } }],
  ])('404s for a request that is %s', async (_label, patch) => {
    state.selectQueue = [[submitRow(patch)], []]
    await expect(submitHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.inserts).toHaveLength(0)
  })

  it('accepts a token that is 59 days old', async () => {
    state.selectQueue = [[submitRow({ sentAt: daysAgo(59) })], []]
    await submitHandler({} as never)
    expect(state.inserts).toHaveLength(1)
  })

  it('rejects a token older than 60 days with 410', async () => {
    state.selectQueue = [[submitRow({ sentAt: daysAgo(61), createdAt: daysAgo(61) })], []]
    await expect(submitHandler({} as never)).rejects.toMatchObject({ statusCode: 410 })
    expect(state.inserts).toHaveLength(0)
  })

  it('measures the age from when it was sent', async () => {
    state.selectQueue = [[submitRow({ sentAt: daysAgo(2), createdAt: daysAgo(90) })], []]
    await submitHandler({} as never)
    expect(state.inserts).toHaveLength(1)
  })
})

describe('GET /api/marketing/r/[token] canSubmit', () => {
  const canSubmit = async () => ((await publicInfo({} as never)) as { data: { canSubmit: boolean } }).data.canSubmit

  it('is true for a fresh sent request', async () => {
    state.selectQueue = [[requestRow()], []]
    expect(await canSubmit()).toBe(true)
  })

  it.each([
    ['expired', { sentAt: daysAgo(61), createdAt: daysAgo(61) }],
    ['not sent', { status: 'queued' }],
    ['testimonials off', { askForTestimonial: false }],
  ])('is false when %s', async (_label, patch) => {
    state.selectQueue = [[requestRow(patch)], []]
    expect(await canSubmit()).toBe(false)
  })
})

describe('GET go link expiry', () => {
  it('still redirects an expired link but does not record the click', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[requestRow({ sentAt: daysAgo(61), createdAt: daysAgo(61) })]]
    await goHandler({} as never)
    expect(state.redirect).toEqual({ url: 'https://www.g2.com/products/acme/reviews', code: 302 })
    expect(state.updates).toHaveLength(0)
  })

  it('records the click on a link inside the window', async () => {
    state.query = { p: 'g2' }
    state.selectQueue = [[requestRow({ sentAt: daysAgo(59) })]]
    await goHandler({} as never)
    expect(state.updates).toHaveLength(1)
  })
})

describe('unsubscribe stays available for old links', () => {
  it('writes the suppression for an expired request', async () => {
    state.selectQueue = [[requestRow({ sentAt: daysAgo(400), createdAt: daysAgo(400), status: 'failed' })]]
    await unsubPost({} as never)
    expect(state.inserts).toHaveLength(1)
  })
})

describe('GET reviews settings canManage', () => {
  const settingsGet = async () =>
    (await import('~/server/api/marketing/projects/[projectId]/reviews/settings.get')).default

  it('is true for a team admin', async () => {
    state.selectQueue = [[], []]
    const handler = await settingsGet()
    const response = (await handler({} as never)) as { data: { canManage: boolean; settings: { enabled: boolean } } }
    expect(response.data.canManage).toBe(true)
    expect(response.data.settings.enabled).toBe(false)
  })

  it('is false for a member who is not an admin, who can still read the settings', async () => {
    state.teamAdmin = false
    state.selectQueue = [[], []]
    const handler = await settingsGet()
    const response = (await handler({} as never)) as { data: { canManage: boolean } }
    expect(response.data.canManage).toBe(false)
  })

  it('still requires marketing access', async () => {
    state.access = 'forbidden'
    const handler = await settingsGet()
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET testimonials list', () => {
  it('returns the team slug for the public wall link', async () => {
    state.selectQueue = [[], [], [{ slug: 'acme' }]]
    const response = (await testimonialsGet({} as never)) as { data: { teamSlug: string | null } }
    expect(response.data.teamSlug).toBe('acme')
  })
})
