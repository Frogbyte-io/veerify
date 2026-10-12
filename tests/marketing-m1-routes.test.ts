import { getTableName, is, Table } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { projectId: 'p1', teamId: 't1', provider: 'anthropic', termId: 'term1' } as Record<string, string>,
  role: 'member' as 'member' | 'admin',
  marketingOn: true,
  projectSettings: null as Record<string, unknown> | null,
  secretsConfigured: true,
  rows: [] as unknown[][],
  // Per-table result queues for routes that query concurrently (empty = use `rows` in call order)
  byTable: {} as Record<string, unknown[][]>,
  ops: [] as Array<{ op: string; args: unknown[] }>,
  validateLlm: { ok: true } as { ok: boolean; kind?: string; message?: string },
  validateCrawl: { ok: true } as { ok: boolean; kind?: string; message?: string },
  checkVerification: { verified: true, detail: 'ok' },
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

function chain(): unknown {
  const target = function () {}
  let tableName: string | null = null
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const keyed = Object.keys(state.byTable).length > 0
          const result = keyed ? (tableName ? state.byTable[tableName]?.shift() : undefined) : state.rows.shift()
          return Promise.resolve(result ?? []).then(resolve, reject)
        }
      }
      return (...args: unknown[]) => {
        if (prop === 'from' && is(args[0], Table)) tableName = getTableName(args[0])
        state.ops.push({ op: String(prop), args })
        return proxy
      }
    },
  })
  return proxy
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/database/drizzle', () => {
  const db: Record<string, unknown> = {
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    delete: () => chain(),
    // advisory lock statements do not consume queued rows
    execute: async () => undefined,
  }
  db.transaction = async (callback: (tx: unknown) => unknown) => callback(db)
  return { db }
})

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (!state.marketingOn) throw httpError(403, 'Marketing is not enabled for this team')
    return { project: { id: 'p1', teamId: 't1', settings: state.projectSettings }, teamId: 't1' }
  }),
  requireMarketingAdmin: vi.fn(async () => {
    if (!state.marketingOn) throw httpError(403, 'Marketing is not enabled for this team')
    if (state.role !== 'admin') throw httpError(403, 'Only team admins can manage Marketing settings')
    return { project: { id: 'p1', teamId: 't1' }, teamId: 't1' }
  }),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async () => {
    if (state.role !== 'admin') throw httpError(403, 'Forbidden')
    return { id: 'm1', role: 'admin' }
  }),
  requireTeamMembership: vi.fn(async () => ({ id: 'm1', role: state.role })),
}))

vi.mock('~/server/utils/rate-limit', () => ({ requireRateLimit: vi.fn(async () => undefined) }))

vi.mock('~/server/utils/secrets', () => ({
  isSecretsConfigured: () => state.secretsConfigured,
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  keyHint: (k: string) => k.slice(-4),
}))

vi.mock('~/server/utils/team-credentials', async (importActual) => {
  const actual = await importActual<typeof import('~/server/utils/team-credentials')>()
  return {
    ...actual,
    listTeamCredentials: vi.fn(async () => [
      {
        provider: 'anthropic',
        keyHint: 'abcd',
        status: 'valid',
        monthlyBudgetCents: null,
        lastValidatedAt: null,
        lastError: null,
        updatedAt: new Date(),
      },
    ]),
    saveTeamCredential: vi.fn(async (input: Record<string, unknown>) => ({
      provider: input.provider,
      keyHint: String(input.apiKey).slice(-4),
      status: input.status,
      monthlyBudgetCents: input.monthlyBudgetCents ?? null,
      lastValidatedAt: null,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })),
    updateCredentialBudget: vi.fn(async () => true),
    deleteTeamCredential: vi.fn(async () => true),
  }
})

vi.mock('~/server/services/llm', () => ({
  getLlmProvider: () => ({ validateKey: vi.fn(async () => state.validateLlm) }),
}))

vi.mock('~/server/services/crawl', () => ({
  getCrawlProvider: () => ({ validateKey: vi.fn(async () => state.validateCrawl) }),
  resolveCrawlConfig: (key: string | null) => (key ? { apiKey: key, baseUrl: 'https://crawl.test' } : null),
}))

vi.mock('~/server/services/marketing/site-verification', async (importActual) => {
  const actual = await importActual<typeof import('~/server/services/marketing/site-verification')>()
  return { ...actual, checkVerification: vi.fn(async () => state.checkVerification) }
})

const teamCredentials = await import('~/server/utils/team-credentials')
const rateLimit = await import('~/server/utils/rate-limit')

const event = {} as never
const run = async (handler: unknown) => (handler as (e: never) => Promise<any>)(event)
const load = async (path: string) => (await import(path)).default

const existingSite = {
  id: 's1',
  projectId: 'p1',
  teamId: 't1',
  origin: 'https://example.com',
  verificationMethod: 'dns',
  verificationToken: 'old-token',
  verifiedAt: new Date('2026-10-01'),
  lastVerificationError: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.body = {}
  state.params = { projectId: 'p1', teamId: 't1', provider: 'anthropic', termId: 'term1' }
  state.role = 'member'
  state.marketingOn = true
  state.secretsConfigured = true
  state.rows = []
  state.byTable = {}
  state.ops = []
  state.validateLlm = { ok: true }
  state.validateCrawl = { ok: true }
  state.checkVerification = { verified: true, detail: 'ok' }
})

const lastSet = () => state.ops.filter((o) => o.op === 'set').at(-1)?.args[0] as Record<string, unknown>
const lastValues = () => state.ops.filter((o) => o.op === 'values').at(-1)?.args[0] as Record<string, unknown>

describe('GET site', () => {
  it('returns null site and no verification when none exists', async () => {
    state.rows = [[]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.get')
    const res = await run(handler)
    expect(res.data).toEqual({ site: null, verification: null, canManage: false })
  })

  it('returns instructions and canManage by role, without the token inside site', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.get')
    state.rows = [[existingSite]]
    const member = await run(handler)
    expect(member.data.canManage).toBe(false)
    expect(member.data.site).not.toHaveProperty('verificationToken')
    expect(member.data.verification).toEqual({
      token: 'old-token',
      dnsRecord: { host: '_veerify.example.com', type: 'TXT', value: 'veerify-site-verification=old-token' },
      metaTag: '<meta name="veerify-site-verification" content="old-token">',
      filePath: '/.well-known/veerify-verification.txt',
      fileContent: 'old-token',
    })

    state.role = 'admin'
    state.rows = [[existingSite]]
    expect((await run(handler)).data.canManage).toBe(true)
  })

  it('propagates 403 when marketing is off', async () => {
    state.marketingOn = false
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.get')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('PUT site', () => {
  it('rejects non-admins', async () => {
    state.body = { origin: 'example.com' }
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects an invalid origin with 400', async () => {
    state.role = 'admin'
    state.body = { origin: 'http://localhost:3000' }
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('creates an unverified site with a fresh token', async () => {
    state.role = 'admin'
    state.body = { origin: 'https://Example.com/pricing' }
    // findMarketingSite, domains, insert returning
    state.rows = [
      [],
      [],
      [{ ...existingSite, origin: 'https://example.com', verifiedAt: null, verificationMethod: null }],
    ]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    const res = await run(handler)
    const values = lastValues()
    expect(values.origin).toBe('https://example.com')
    expect(values.verifiedAt).toBeNull()
    expect(typeof values.verificationToken).toBe('string')
    expect((values.verificationToken as string).length).toBeGreaterThan(20)
    expect(res.data.canManage).toBe(true)
  })

  it('resets verification and issues a new token when the origin changes', async () => {
    state.role = 'admin'
    state.body = { origin: 'other.com' }
    state.rows = [[existingSite], [], [{ ...existingSite, origin: 'https://other.com', verifiedAt: null }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    await run(handler)
    const set = lastSet()
    expect(set.origin).toBe('https://other.com')
    expect(set.verifiedAt).toBeNull()
    expect(set.verificationMethod).toBeNull()
    expect(set.verificationToken).toBeTypeOf('string')
    expect(set.verificationToken).not.toBe('old-token')
  })

  it('keeps an already verified site untouched when the origin is unchanged', async () => {
    state.role = 'admin'
    state.body = { origin: 'example.com' }
    state.rows = [[existingSite]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    const res = await run(handler)
    expect(state.ops.some((o) => o.op === 'set' || o.op === 'values')).toBe(false)
    expect(res.data.site.verified).toBe(true)
  })

  it('verifies immediately with method domain when a verified custom domain covers the origin', async () => {
    state.role = 'admin'
    state.body = { origin: 'https://www.acme.com' }
    state.rows = [[], [{ hostname: 'feedback.acme.com' }], [{ ...existingSite, origin: 'https://www.acme.com' }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    await run(handler)
    const values = lastValues()
    expect(values.verificationMethod).toBe('domain')
    expect(values.verifiedAt).toBeInstanceOf(Date)
  })

  it('does not auto-verify when the custom domain belongs to another registrable domain', async () => {
    state.role = 'admin'
    state.body = { origin: 'https://acme.com' }
    state.rows = [[], [{ hostname: 'feedback.other.org' }], [existingSite]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site.put')
    await run(handler)
    expect(lastValues().verifiedAt).toBeNull()
  })
})

describe('POST site verify', () => {
  it('rejects non-admins', async () => {
    state.body = { method: 'dns' }
    const handler = await load('~/server/api/marketing/projects/[projectId]/site/verify.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects unknown methods', async () => {
    state.role = 'admin'
    state.body = { method: 'carrier-pigeon' }
    const handler = await load('~/server/api/marketing/projects/[projectId]/site/verify.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404s when no site exists', async () => {
    state.role = 'admin'
    state.body = { method: 'dns' }
    state.rows = [[]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site/verify.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('persists a successful check and rate limits per site', async () => {
    state.role = 'admin'
    state.body = { method: 'meta' }
    state.rows = [[{ ...existingSite, verifiedAt: null }], [{ ...existingSite, verificationMethod: 'meta' }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site/verify.post')
    const res = await run(handler)
    expect(lastSet()).toMatchObject({ verificationMethod: 'meta', lastVerificationError: null })
    expect(lastSet().verifiedAt).toBeInstanceOf(Date)
    expect(res.data.site.verified).toBe(true)
    expect(rateLimit.requireRateLimit).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ maxRequests: 10, windowSeconds: 3600, subject: 's1' })
    )
  })

  it('persists the error of a failed check without verifying', async () => {
    state.role = 'admin'
    state.body = { method: 'file' }
    state.checkVerification = { verified: false, detail: 'Verification file returned HTTP 404' }
    state.rows = [[{ ...existingSite, verifiedAt: null }], [{ ...existingSite, verifiedAt: null }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/site/verify.post')
    await run(handler)
    const set = lastSet()
    expect(set.lastVerificationError).toBe('Verification file returned HTTP 404')
    expect(set).not.toHaveProperty('verifiedAt')
  })
})

describe('credentials routes', () => {
  const KEY = 'sk-ant-secret-key-1234'

  it('lists for members without exposing key material', async () => {
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/index.get')
    const res = await run(handler)
    expect(res.data.canManage).toBe(false)
    expect(res.data.secretsConfigured).toBe(true)
    expect(JSON.stringify(res)).not.toMatch(/encryptedKey|apiKey/)
  })

  it('admin sees canManage and secretsConfigured false when no encryption key is set', async () => {
    state.role = 'admin'
    state.secretsConfigured = false
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/index.get')
    const res = await run(handler)
    expect(res.data).toMatchObject({ canManage: true, secretsConfigured: false })
  })

  it('PUT rejects non-admins', async () => {
    state.body = { apiKey: KEY }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
    expect(teamCredentials.saveTeamCredential).not.toHaveBeenCalled()
  })

  it('PUT returns 503 when secrets are not configured', async () => {
    state.role = 'admin'
    state.secretsConfigured = false
    state.body = { apiKey: KEY }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 503 })
    expect(teamCredentials.saveTeamCredential).not.toHaveBeenCalled()
  })

  it('PUT rejects an unknown provider', async () => {
    state.role = 'admin'
    state.params.provider = 'mistral'
    state.body = { apiKey: KEY }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('PUT does not save a key the provider rejects, and never echoes it', async () => {
    state.role = 'admin'
    state.body = { apiKey: KEY }
    state.validateLlm = { ok: false, kind: 'auth', message: `Invalid key ${KEY}` }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    const error = await run(handler).catch((e) => e)
    expect(error.statusCode).toBe(400)
    expect(JSON.stringify(error.data)).not.toContain(KEY)
    expect(teamCredentials.saveTeamCredential).not.toHaveBeenCalled()
  })

  it('PUT saves a valid key as valid and never returns it', async () => {
    state.role = 'admin'
    state.body = { apiKey: KEY, monthlyBudgetCents: 2500 }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    const res = await run(handler)
    expect(teamCredentials.saveTeamCredential).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'valid', lastError: null, monthlyBudgetCents: 2500, teamId: 't1' })
    )
    expect(JSON.stringify(res)).not.toContain(KEY)
    expect(res.data.credential.keyHint).toBe('1234')
  })

  it.each(['gemini', 'perplexity'])('PUT validates and saves a %s key with a budget', async (provider) => {
    state.role = 'admin'
    state.params.provider = provider
    state.body = { apiKey: KEY, monthlyBudgetCents: 500 }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await run(handler)
    expect(teamCredentials.saveTeamCredential).toHaveBeenCalledWith(
      expect.objectContaining({ provider, status: 'valid', monthlyBudgetCents: 500 })
    )
  })

  it('PUT saves unchecked with the error on network or server failures', async () => {
    state.role = 'admin'
    state.body = { apiKey: KEY }
    state.validateLlm = { ok: false, kind: 'server', message: 'Provider is down' }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await run(handler)
    expect(teamCredentials.saveTeamCredential).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unchecked', lastError: 'Provider is down' })
    )
  })

  it('PUT validates firecrawl keys through the crawl provider', async () => {
    state.role = 'admin'
    state.params.provider = 'firecrawl'
    state.body = { apiKey: 'fc-abcdefgh' }
    state.validateCrawl = { ok: false, kind: 'auth', message: 'Unauthorized' }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
    expect(teamCredentials.saveTeamCredential).not.toHaveBeenCalled()
  })

  it('PUT saves pagespeed keys unchecked', async () => {
    state.role = 'admin'
    state.params.provider = 'pagespeed'
    state.body = { apiKey: 'AIza-abcdefgh' }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await run(handler)
    expect(teamCredentials.saveTeamCredential).toHaveBeenCalledWith(expect.objectContaining({ status: 'unchecked' }))
  })

  it('PUT rejects a budget on non-LLM providers', async () => {
    state.role = 'admin'
    state.params.provider = 'firecrawl'
    state.body = { apiKey: 'fc-abcdefgh', monthlyBudgetCents: 100 }
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].put')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('PATCH requires admin, LLM providers and an existing key', async () => {
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].patch')
    state.body = { monthlyBudgetCents: 500 }
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })

    state.role = 'admin'
    state.params.provider = 'pagespeed'
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })

    state.params.provider = 'openai'
    vi.mocked(teamCredentials.updateCredentialBudget).mockResolvedValueOnce(false)
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 404 })

    const res = await run(handler)
    expect(res.data).toEqual({ provider: 'openai', monthlyBudgetCents: 500 })
    state.body = { monthlyBudgetCents: null }
    expect((await run(handler)).data.monthlyBudgetCents).toBeNull()
  })

  it('DELETE requires admin and removes the key', async () => {
    const handler = await load('~/server/api/marketing/teams/[teamId]/credentials/[provider].delete')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
    state.role = 'admin'
    await run(handler)
    expect(teamCredentials.deleteTeamCredential).toHaveBeenCalledWith('t1', 'anthropic')
  })
})

describe('terms routes', () => {
  const siteRow = [existingSite]

  it('lists terms for any member and 404s without a site', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.get')
    state.rows = [[]]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 404 })

    state.rows = [
      siteRow,
      [{ id: 'term1', kind: 'brand', label: 'Acme', aliases: [], competitorDomain: null, createdAt: new Date() }],
    ]
    const res = await run(handler)
    expect(res.data.terms).toHaveLength(1)
    expect(res.data.limit).toBe(50)
    expect(res.data.canManage).toBe(false)
  })

  it('denies access when marketing is off', async () => {
    state.marketingOn = false
    state.body = { kind: 'brand', label: 'Acme' }
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a term with de-duplicated aliases', async () => {
    state.body = { kind: 'brand', label: 'Acme', aliases: ['ACME', 'Acme Inc', 'acme inc'] }
    state.rows = [
      siteRow,
      [{ total: 3 }],
      [
        {
          id: 'new',
          kind: 'brand',
          label: 'Acme',
          aliases: ['Acme Inc'],
          competitorDomain: null,
          createdAt: new Date(),
        },
      ],
    ]
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.post')
    await run(handler)
    expect(lastValues()).toMatchObject({ siteId: 's1', kind: 'brand', label: 'Acme', aliases: ['Acme Inc'] })
  })

  it.each([
    ['label too short', { kind: 'brand', label: 'A' }],
    ['label too long', { kind: 'brand', label: 'x'.repeat(81) }],
    ['too many aliases', { kind: 'brand', label: 'Acme', aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) }],
    ['domain on a brand', { kind: 'brand', label: 'Acme', competitorDomain: 'acme.com' }],
    ['bad domain', { kind: 'competitor', label: 'Rival', competitorDomain: 'not a domain' }],
    ['unknown kind', { kind: 'person', label: 'Acme' }],
  ])('rejects %s', async (_name, body) => {
    state.body = body
    state.rows = [siteRow, [{ total: 0 }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('normalizes the competitor domain', async () => {
    state.body = { kind: 'competitor', label: 'Rival', competitorDomain: 'https://www.Rival.com/pricing' }
    state.rows = [
      siteRow,
      [{ total: 0 }],
      [{ id: 'n', kind: 'competitor', label: 'Rival', aliases: [], createdAt: new Date() }],
    ]
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.post')
    await run(handler)
    expect(lastValues().competitorDomain).toBe('rival.com')
  })

  it('enforces the 50 term limit', async () => {
    state.body = { kind: 'keyword', label: 'feedback tool' }
    state.rows = [siteRow, [{ total: 50 }]]
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/index.post')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.ops.some((o) => o.op === 'values')).toBe(false)
  })

  it('updates a term, 404s for an unknown one, and refuses a domain on a non-competitor', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/[termId].put')
    state.body = { label: 'Acme Co', aliases: ['AC'] }
    state.rows = [siteRow, []]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 404 })

    const current = { id: 'term1', siteId: 's1', kind: 'brand', label: 'Acme', aliases: [], competitorDomain: null }
    state.rows = [siteRow, [current], [{ ...current, label: 'Acme Co', aliases: ['AC'], createdAt: new Date() }]]
    await run(handler)
    expect(lastSet()).toMatchObject({ label: 'Acme Co', aliases: ['AC'], competitorDomain: null })

    state.body = { label: 'Acme Co', competitorDomain: 'acme.com' }
    state.rows = [siteRow, [current]]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('needs a marketing admin to change or clear the domain of a competitor that has watches', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/[termId].put')
    const rival = {
      id: 'term1',
      siteId: 's1',
      kind: 'competitor',
      label: 'Rival',
      aliases: [],
      competitorDomain: 'rival.com',
    }
    const updated = { ...rival, createdAt: new Date() }

    state.role = 'member'
    state.body = { label: 'Rival', competitorDomain: 'rival.io' }
    state.rows = [siteRow, [rival], [{ count: 2 }]]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
    state.body = { label: 'Rival', competitorDomain: null }
    state.rows = [siteRow, [rival], [{ count: 2 }]]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })

    // unchanged domain, or no watches: a member may edit
    state.body = { label: 'Rival Inc', competitorDomain: 'www.rival.com' }
    state.rows = [siteRow, [rival], [updated]]
    await run(handler)
    state.body = { label: 'Rival', competitorDomain: 'rival.io' }
    state.rows = [siteRow, [rival], [{ count: 0 }], [updated]]
    await run(handler)

    state.role = 'admin'
    state.body = { label: 'Rival', competitorDomain: 'rival.io' }
    state.rows = [siteRow, [rival], [{ count: 2 }], [updated]]
    await run(handler)
    state.role = 'member'
  })

  it('refuses a public-suffix-only competitor domain', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/[termId].put')
    const rival = { id: 'term1', siteId: 's1', kind: 'competitor', label: 'Rival', aliases: [], competitorDomain: null }
    for (const domain of ['github.io', 'vercel.app', 'https://co.uk/']) {
      state.body = { label: 'Rival', competitorDomain: domain }
      state.rows = [siteRow, [rival]]
      await expect(run(handler)).rejects.toMatchObject({ statusCode: 400 })
    }
  })

  it('deletes a term and 404s when it is not on this site', async () => {
    const handler = await load('~/server/api/marketing/projects/[projectId]/terms/[termId].delete')
    state.rows = [siteRow, []]
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 404 })
    state.rows = [siteRow, [{ id: 'term1' }]]
    expect((await run(handler)).data).toEqual({ id: 'term1' })
  })
})

describe('overview route', () => {
  it('denies access when marketing is off', async () => {
    state.marketingOn = false
    const handler = await load('~/server/api/marketing/projects/[projectId]/overview.get')
    await expect(run(handler)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reports an empty setup when no site exists', async () => {
    vi.doMock('~/server/utils/marketing-usage', () => ({ getUsage: async () => ({}) }))
    state.rows = [[]]
    vi.resetModules()
    const handler = await load('~/server/api/marketing/projects/[projectId]/overview.get')
    const res = await run(handler)
    expect(res.data.site).toBeNull()
    expect(res.data.setup).toMatchObject({ siteAdded: false, siteVerified: false, hasBrandTerm: false })
    expect(res.data.setup.hasLlmKey).toBe(true) // anthropic key from the mocked credential list
    expect(res.data.latestAudit).toBeNull()
    expect(res.data.newMentions).toBe(0)
    expect(res.data.search).toMatchObject({ connected: false, totals: null })
    expect(res.data.reviews).toMatchObject({ enabled: false, requestsSent: 0, pendingTestimonials: 0 })
    expect(res.data.announcements).toEqual({ changelogEnabled: false, withoutDrafts: 0 })
    expect(res.data.language).toEqual({ consented: false, lastRunAt: null })
    expect(res.data.changelog).toEqual({ enabled: false, latest: null })
  })

  it('counts only catalog directories in the launch kit progress', async () => {
    vi.doMock('~/server/utils/marketing-usage', () => ({ getUsage: async () => ({}) }))
    vi.resetModules()
    state.rows = [[]]
    state.ops = []
    const { LAUNCH_DIRECTORIES } = await import('~/server/services/marketing/launch-kit/directories')
    const { PgDialect } = await import('drizzle-orm/pg-core')
    const handler = await load('~/server/api/marketing/projects/[projectId]/overview.get')
    await run(handler)
    const queries = state.ops.filter((o) => o.op === 'where').map((o) => new PgDialect().sqlToQuery(o.args[0] as never))
    const kit = queries.find((q) => q.sql.includes('"launch_kit_item"."directory_id" in ('))
    expect(kit).toBeDefined()
    expect(kit!.params).toEqual(expect.arrayContaining(['p1', ...LAUNCH_DIRECTORIES.map((d) => d.id)]))
    expect(kit!.params.some((p) => String(p).startsWith('custom:'))).toBe(false)
  })

  it('computes the mention rate from answers with a brand verdict', async () => {
    vi.doMock('~/server/utils/marketing-usage', () => ({ getUsage: async () => ({ 'crawl:pages': 12 }) }))
    vi.resetModules()
    // Loaders run concurrently, so results are keyed by table rather than call order
    state.byTable = {
      marketing_site: [[existingSite]],
      marketing_term: [[{ total: 1 }]], // brand terms
      seo_audit: [[{ id: 'a1', score: 82, mode: 'basic', status: 'done', finishedAt: new Date() }]],
      ai_visibility_run: [[{ id: 'r1', status: 'done', finishedAt: new Date() }]],
      mention: [[{ total: 4 }]], // new mentions
      ai_visibility_answer: [
        [{ brandMentioned: true }, { brandMentioned: false }, { brandMentioned: true }, { brandMentioned: true }],
      ],
    }
    const handler = await load('~/server/api/marketing/projects/[projectId]/overview.get')
    const res = await run(handler)
    expect(res.data.setup).toMatchObject({ siteAdded: true, siteVerified: true, hasBrandTerm: true })
    expect(res.data.latestAudit).toMatchObject({ id: 'a1', score: 82, mode: 'basic' })
    expect(res.data.latestVisibilityRun).toMatchObject({ id: 'r1', mentionRate: 0.75 })
    expect(res.data.newMentions).toBe(4)
    expect(res.data.usage).toEqual({ 'crawl:pages': 12 })
  })

  it('summarises search, reviews, announcements, language and the changelog', async () => {
    vi.doMock('~/server/utils/marketing-usage', () => ({
      getUsage: async () => ({ 'llm:anthropic:cost_usd_micros': 1_500_000 }),
    }))
    vi.resetModules()
    state.projectSettings = { marketingEnabled: true, changelogEnabled: true }
    const day = (date: string, clicks: number) => ({ date, clicks, impressions: clicks * 10, ctr: 0.1, position: 5 })
    const latestEntry = { id: 'e1', title: 'Dark mode', slug: 'dark-mode', publishedAt: new Date('2026-10-05') }
    const lastRun = new Date('2026-10-03')
    state.byTable = {
      marketing_site: [[existingSite]],
      marketing_term: [[{ total: 0 }]],
      gsc_connection: [[{ status: 'active' }]],
      gsc_daily_metric: [
        [{ date: '2026-10-08' }], // latest synced day
        [day('2026-08-20', 4), day('2026-09-20', 6), day('2026-10-08', 4)], // previous + current period
      ],
      review_request_settings: [[{ enabled: true }]],
      review_request: [[{ total: 7 }]], // requests sent
      testimonial: [[{ total: 2 }]], // pending testimonials
      changelog_entry: [[{ total: 3 }], [latestEntry]], // entries without drafts, then latest entry
      marketing_data_consent: [[{ feedback: true, support: false }]],
      customer_language_insight: [[{ createdAt: lastRun }]],
    }
    const handler = await load('~/server/api/marketing/projects/[projectId]/overview.get')
    const res = await run(handler)
    state.projectSettings = null
    expect(res.data.search).toMatchObject({ connected: true, status: 'active' })
    expect(res.data.search.totals.current).toMatchObject({ clicks: 10, impressions: 100 })
    expect(res.data.search.totals.previous).toMatchObject({ clicks: 4 })
    expect(res.data.reviews).toEqual({ enabled: true, requestsSent: 7, sinceDays: 30, pendingTestimonials: 2 })
    expect(res.data.announcements).toEqual({ changelogEnabled: true, withoutDrafts: 3 })
    expect(res.data.language).toEqual({ consented: true, lastRunAt: lastRun })
    expect(res.data.changelog).toEqual({ enabled: true, latest: latestEntry })
    expect(res.data.usage).toEqual({ 'llm:anthropic:cost_usd_micros': 1_500_000 })
  })
})
