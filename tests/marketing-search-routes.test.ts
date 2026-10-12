import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signOAuthState } from '~/server/services/google/oauth-state'

const KEY = Buffer.alloc(32, 7).toString('base64')

const state = vi.hoisted(() => ({
  params: { projectId: 'p1' } as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  userId: 'u1',
  session: true,
  role: 'admin' as 'admin' | 'member' | 'off',
  site: { id: 'site-1', origin: 'https://acme.com', verifiedAt: new Date() } as {
    id: string
    origin: string
    verifiedAt: Date | null
  } | null,
  conn: null as Record<string, unknown> | null,
  sites: [] as Array<{ siteUrl: string; permissionLevel: string }>,
  selects: [] as unknown[][],
  insertValues: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
  updateSet: null as Record<string, unknown> | null,
  deletes: 0,
  deletedMetrics: 0,
  deletedQueryStats: 0,
  transactions: 0,
  revoked: [] as string[],
  nonces: new Set<string>(),
  exchangeError: false,
  slug: 'acme' as string | null,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('sendRedirect', (_event: unknown, url: string) => ({ redirect: url }))
const createError = (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
vi.stubGlobal('createError', createError)
vi.mock('h3', async (importOriginal) => ({ ...(await importOriginal<typeof import('h3')>()), createError }))

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: state.userId } } })),
}))
vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => {
    if (!state.session) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: { id: state.userId } }
  }),
}))
vi.mock('~/server/utils/marketing-access', () => {
  const forbid = () => Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return {
    requireMarketingAccess: vi.fn(async () => {
      if (state.role === 'off') throw forbid()
      return { project: {}, teamId: 't1' }
    }),
    requireMarketingAdmin: vi.fn(async () => {
      if (state.role !== 'admin') throw forbid()
      return { project: {}, teamId: 't1' }
    }),
  }
})
vi.mock('~/server/utils/marketing-site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/marketing-site')>()),
  findMarketingSite: vi.fn(async () => state.site),
  isTeamAdminOf: vi.fn(async () => state.role === 'admin'),
}))

vi.mock('~/server/database/drizzle', async () => {
  const schema = await import('~/server/database/schema/marketing')
  const select = () => {
    const result = state.selects.shift() ?? []
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'where', 'orderBy', 'limit']) chain[name] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return chain
  }
  const writes = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (typeof values.metric === 'string' && values.metric.startsWith('oauth-nonce:')) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                if (state.nonces.has(values.metric as string)) return []
                state.nonces.add(values.metric as string)
                return [{ metric: values.metric }]
              },
            }),
          }
        }
        state.insertValues = values
        return {
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            state.conflictSet = set
          },
        }
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updateSet = values
        return { where: async () => undefined }
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        if (table === schema.gscDailyMetric) state.deletedMetrics += 1
        else if (table === schema.gscQueryStat) state.deletedQueryStats += 1
        else state.deletes += 1
      },
    }),
  }
  // Inside a transaction the connection row is read with `select ... for update`
  const lockingSelect = () => {
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'where', 'for']) chain[name] = () => chain
    chain.limit = async () => (state.conn ? [state.conn] : [])
    return chain
  }
  const tx = { ...writes, select: lockingSelect }
  return {
    db: {
      select,
      ...writes,
      transaction: async (fn: (t: unknown) => unknown) => {
        state.transactions += 1
        return fn(tx)
      },
    },
  }
})

vi.mock('~/server/services/marketing/search/connection', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/server/services/marketing/search/connection')>()
  return {
    ...original,
    findGscConnection: vi.fn(async () => state.conn),
    requireGscConnection: vi.fn(async () => {
      if (!state.conn) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
      return state.conn
    }),
    getAccessTokenFor: vi.fn(async () => 'access-token'),
  }
})

vi.mock('~/server/services/google/search-console', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/server/services/google/search-console')>()
  return {
    ...original,
    exchangeCode: vi.fn(async () => {
      if (state.exchangeError) throw new original.GoogleApiError('bad_request', 'nope')
      return {
        refreshToken: 'REFRESH-TOKEN-123',
        accessToken: 'ACCESS-TOKEN-456',
        expiresAt: new Date(),
        email: 'o@acme.com',
      }
    }),
    listSites: vi.fn(async () => state.sites),
    revokeToken: vi.fn(async (token: string) => {
      state.revoked.push(token)
      return true
    }),
  }
})

const connect = (await import('~/server/api/marketing/projects/[projectId]/search/connect.get')).default
const callback = (await import('~/server/api/marketing/google/callback.get')).default
const properties = (await import('~/server/api/marketing/projects/[projectId]/search/properties.get')).default
const putProperty = (await import('~/server/api/marketing/projects/[projectId]/search/property.put')).default
const disconnect = (await import('~/server/api/marketing/projects/[projectId]/search/connection.delete')).default
const summary = (await import('~/server/api/marketing/projects/[projectId]/search/summary.get')).default
const { decryptSecret, encryptSecret } = await import('~/server/utils/secrets')

const run = (handler: unknown) => (handler as (event: unknown) => Promise<any>)({})
const failure = async (handler: unknown) =>
  run(handler).then(
    () => null,
    (e: any) => e
  )

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret')
  vi.stubEnv('BETTER_AUTH_URL', 'https://app.test')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret')
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', KEY)
  state.params = { projectId: 'p1' }
  state.body = {}
  state.query = {}
  state.userId = 'u1'
  state.session = true
  state.role = 'admin'
  state.site = { id: 'site-1', origin: 'https://acme.com', verifiedAt: new Date() }
  state.conn = null
  state.sites = []
  state.selects = []
  state.insertValues = null
  state.conflictSet = null
  state.updateSet = null
  state.deletes = 0
  state.deletedMetrics = 0
  state.deletedQueryStats = 0
  state.transactions = 0
  state.revoked = []
  state.nonces = new Set()
  state.exchangeError = false
  state.slug = 'acme'
})

describe('GET search/connect', () => {
  it('returns a Google URL carrying a signed state', async () => {
    const result = await run(connect)
    const url = new URL(result.data.url)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/marketing/google/callback')
    expect(url.searchParams.get('state')?.split('.')).toHaveLength(2)
    expect(result.data.url).not.toContain('csecret')
  })

  it('rejects members and a disabled module', async () => {
    state.role = 'member'
    expect((await failure(connect)).statusCode).toBe(403)
    state.role = 'off'
    expect((await failure(connect)).statusCode).toBe(403)
  })

  it('requires a verified site', async () => {
    state.site = { id: 'site-1', origin: 'https://acme.com', verifiedAt: null }
    expect((await failure(connect)).statusCode).toBe(409)
    state.site = null
    expect((await failure(connect)).statusCode).toBe(409)
  })

  it('returns 503 naming the missing variables when Google is not configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    const error = await failure(connect)
    expect(error.statusCode).toBe(503)
    expect(error.data.error.message).toContain('GOOGLE_CLIENT_ID')
  })

  it('returns 503 when secrets encryption is not configured', async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', '')
    const error = await failure(connect)
    expect(error.statusCode).toBe(503)
    expect(error.data.error.message).toContain('SECRETS_ENCRYPTION_KEY')
  })
})

describe('GET google/callback', () => {
  const goodState = () => signOAuthState({ siteId: 'site-1', userId: 'u1', projectId: 'p1' })
  beforeEach(() => {
    state.selects = [[{ slug: 'acme' }]]
    state.query = { code: 'auth-code', state: goodState() }
  })

  it('stores an encrypted refresh token and redirects without any token', async () => {
    state.sites = [
      { siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' },
    ]
    const result = await run(callback)

    expect(result.redirect).toBe('/marketing/search?product=acme&connected=1')
    expect(result.redirect).not.toContain('TOKEN')
    const stored = state.insertValues!
    expect(stored).toMatchObject({
      siteId: 'site-1',
      googleAccountEmail: 'o@acme.com',
      propertyUrl: 'sc-domain:acme.com',
      status: 'connected',
      lastSyncAt: null,
      connectedByUserId: 'u1',
    })
    expect(stored.encryptedRefreshToken).not.toContain('REFRESH-TOKEN-123')
    expect(decryptSecret(stored.encryptedRefreshToken as string, 'gsc:site-1')).toBe('REFRESH-TOKEN-123')
    expect(() => decryptSecret(stored.encryptedRefreshToken as string, 'gsc:other')).toThrow()
    expect(state.conflictSet).toMatchObject({ lastSyncAt: null, status: 'connected' })
  })

  it('needs a property when none matches', async () => {
    state.sites = [{ siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' }]
    await run(callback)
    expect(state.insertValues).toMatchObject({ status: 'needs_property', propertyUrl: null })
  })

  it('clears old metrics when the property changes on reconnect', async () => {
    state.conn = { siteId: 'site-1', propertyUrl: 'https://old.com/' }
    state.sites = [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }]
    await run(callback)
    expect(state.deletedMetrics).toBe(1)
  })

  it('rejects a replayed state: the nonce is single-use', async () => {
    state.sites = [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }]
    const first = await run(callback)
    expect(first.redirect).toContain('connected=1')
    state.insertValues = null
    state.selects = [[{ slug: 'acme' }]]
    const second = await run(callback)
    expect(second.redirect).toBe('/marketing/search?product=acme&error=invalid_state')
    expect(state.insertValues).toBeNull()
  })

  it('revokes the replaced refresh token on reconnect', async () => {
    state.conn = {
      siteId: 'site-1',
      propertyUrl: 'sc-domain:acme.com',
      encryptedRefreshToken: encryptSecret('OLD-TOKEN', 'gsc:site-1'),
    }
    state.sites = [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }]
    await run(callback)
    expect(state.revoked).toEqual(['OLD-TOKEN'])
  })

  it('does not revoke when Google returned the same token (it would kill the new connection)', async () => {
    state.conn = {
      siteId: 'site-1',
      propertyUrl: 'sc-domain:acme.com',
      encryptedRefreshToken: encryptSecret('REFRESH-TOKEN-123', 'gsc:site-1'),
    }
    state.sites = [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }]
    await run(callback)
    expect(state.revoked).toEqual([])
  })

  it('does not revoke on a first connection', async () => {
    await run(callback)
    expect(state.revoked).toEqual([])
  })

  it('rejects a bad or tampered state', async () => {
    state.query = { code: 'c', state: 'garbage' }
    expect((await run(callback)).redirect).toBe('/marketing/search?error=invalid_state')
    // Flip a character inside the signature that carries real bits (the last
    // base64url character is partly padding).
    const [data, sig] = goodState().split('.')
    state.query = { code: 'c', state: `${data}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}` }
    expect((await run(callback)).redirect).toBe('/marketing/search?error=invalid_state')
    expect(state.insertValues).toBeNull()
  })

  it('rejects an expired state', async () => {
    state.query = { code: 'c', state: signOAuthState({ siteId: 'site-1', userId: 'u1', projectId: 'p1' }, -1000) }
    expect((await run(callback)).redirect).toBe('/marketing/search?error=expired_state')
    expect(state.insertValues).toBeNull()
  })

  it('rejects a session user that did not start the flow', async () => {
    state.userId = 'someone-else'
    expect((await run(callback)).redirect).toBe('/marketing/search?error=user_mismatch')
    expect(state.insertValues).toBeNull()
  })

  it('rejects a user who is no longer a marketing admin', async () => {
    state.role = 'member'
    expect((await run(callback)).redirect).toBe('/marketing/search?product=acme&error=forbidden')
    expect(state.insertValues).toBeNull()
  })

  it('handles access_denied from Google', async () => {
    state.query = { error: 'access_denied', state: goodState() }
    expect((await run(callback)).redirect).toBe('/marketing/search?product=acme&error=access_denied')
    expect(state.insertValues).toBeNull()
  })

  it('reports a failed code exchange without details', async () => {
    state.exchangeError = true
    const result = await run(callback)
    expect(result.redirect).toBe('/marketing/search?product=acme&error=exchange_failed')
    expect(result.redirect).not.toContain('nope')
  })

  it('fails when the site changed or lost verification during the flow', async () => {
    state.site = { id: 'site-2', origin: 'https://acme.com', verifiedAt: new Date() }
    expect((await run(callback)).redirect).toContain('error=site_changed')
    state.site = { id: 'site-1', origin: 'https://acme.com', verifiedAt: null }
    // The first attempt consumed the state's nonce; a real retry starts a new flow
    state.selects = [[{ slug: 'acme' }]]
    state.query = { code: 'auth-code', state: goodState() }
    expect((await run(callback)).redirect).toContain('error=site_changed')
  })

  it('sends signed-out users to login', async () => {
    state.session = false
    expect((await run(callback)).redirect).toBe('/login')
  })
})

describe('GET search/properties', () => {
  beforeEach(() => {
    state.conn = { siteId: 'site-1', propertyUrl: null, encryptedRefreshToken: 'x' }
    state.sites = [
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://nope.com/', permissionLevel: 'siteUnverifiedUser' },
    ]
  })

  it('lists readable properties for admins', async () => {
    const result = await run(properties)
    expect(result.data.properties).toEqual([
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner', selectable: true },
    ])
  })

  it('rejects members and unconnected sites', async () => {
    state.role = 'member'
    expect((await failure(properties)).statusCode).toBe(403)
    state.role = 'admin'
    state.conn = null
    expect((await failure(properties)).statusCode).toBe(404)
  })
})

describe('PUT search/property', () => {
  beforeEach(() => {
    state.conn = { siteId: 'site-1', propertyUrl: null, encryptedRefreshToken: 'x' }
    state.sites = [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }]
    state.body = { propertyUrl: 'sc-domain:acme.com' }
  })

  it('sets an available property and marks the connection connected', async () => {
    const result = await run(putProperty)
    expect(result.data).toEqual({ propertyUrl: 'sc-domain:acme.com', status: 'connected' })
    expect(state.updateSet).toMatchObject({ propertyUrl: 'sc-domain:acme.com', status: 'connected', lastSyncAt: null })
  })

  it('rejects a property the account cannot read', async () => {
    state.body = { propertyUrl: 'sc-domain:evil.com' }
    expect((await failure(putProperty)).statusCode).toBe(400)
    expect(state.updateSet).toBeNull()
  })

  it('rejects a readable property that belongs to a different site', async () => {
    state.sites = [
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://acme.com/blog/', permissionLevel: 'siteOwner' },
    ]
    for (const propertyUrl of ['sc-domain:other.com', 'https://acme.com/blog/']) {
      state.body = { propertyUrl }
      expect((await failure(putProperty)).statusCode).toBe(400)
    }
    expect(state.updateSet).toBeNull()
  })

  it('rejects an empty body and non-admins', async () => {
    state.body = {}
    expect((await failure(putProperty)).statusCode).toBe(400)
    state.body = { propertyUrl: 'sc-domain:acme.com' }
    state.role = 'member'
    expect((await failure(putProperty)).statusCode).toBe(403)
  })

  it('clears metrics only when the property changes', async () => {
    await run(putProperty)
    expect(state.deletedMetrics).toBe(1)
    expect(state.deletedQueryStats).toBe(1)
    // metric deletion and the property update share one transaction
    expect(state.transactions).toBe(1)
    state.deletedMetrics = 0
    state.conn = { siteId: 'site-1', propertyUrl: 'sc-domain:acme.com', encryptedRefreshToken: 'x' }
    await run(putProperty)
    expect(state.deletedMetrics).toBe(0)
  })
})

describe('DELETE search/connection', () => {
  it('revokes the token and deletes the connection and metrics', async () => {
    state.conn = { siteId: 'site-1', encryptedRefreshToken: encryptSecret('REFRESH-TOKEN-123', 'gsc:site-1') }
    const result = await run(disconnect)
    expect(result.data).toEqual({ disconnected: true })
    expect(state.revoked).toEqual(['REFRESH-TOKEN-123'])
    expect(state.deletedMetrics).toBe(1)
    expect(state.deletes).toBe(1)
  })

  it('still disconnects when the token cannot be decrypted', async () => {
    state.conn = { siteId: 'site-1', encryptedRefreshToken: 'garbage' }
    await run(disconnect)
    expect(state.revoked).toEqual([])
    expect(state.deletes).toBe(1)
  })

  it('is admin only', async () => {
    state.role = 'member'
    expect((await failure(disconnect)).statusCode).toBe(403)
  })
})

describe('GET search/summary', () => {
  it('is readable by members and reports configuration', async () => {
    state.role = 'member'
    const result = await run(summary)
    expect(result.data).toMatchObject({
      configured: true,
      canManage: false,
      connection: null,
      site: { origin: 'https://acme.com', verified: true },
    })
  })

  it('reports not configured without the Google app', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    expect((await run(summary)).data.configured).toBe(false)
  })

  it('is forbidden when marketing is off', async () => {
    state.role = 'off'
    expect((await failure(summary)).statusCode).toBe(403)
  })

  it('returns weighted totals, the previous period and the top queries', async () => {
    state.query = { days: '7' }
    state.conn = {
      siteId: 'site-1',
      status: 'connected',
      googleAccountEmail: 'o@acme.com',
      propertyUrl: 'sc-domain:acme.com',
      lastSyncAt: new Date('2026-10-10T00:00:00Z'),
      lastError: null,
      encryptedRefreshToken: 'secret-payload',
    }
    const day = (date: string, clicks: number, impressions: number, position: number) => ({
      date,
      clicks,
      impressions,
      ctr: clicks / impressions,
      position,
    })
    state.selects = [
      [{ date: '2026-10-14' }],
      [day('2026-10-02', 5, 100, 4), day('2026-10-09', 10, 100, 2), day('2026-10-14', 30, 900, 10)],
      [{ periodEnd: '2026-10-11' }],
      [{ query: 'feedback', clicks: 9, impressions: 90, ctr: 0.1, position: 2 }],
    ]
    const result = await run(summary)

    expect(result.data.connection).toEqual({
      status: 'connected',
      email: 'o@acme.com',
      propertyUrl: 'sc-domain:acme.com',
      lastSyncAt: new Date('2026-10-10T00:00:00Z'),
      lastError: null,
    })
    expect(JSON.stringify(result)).not.toContain('secret-payload')
    expect(result.data.totals.current).toMatchObject({ clicks: 40, impressions: 1000 })
    expect(result.data.totals.current.position).toBeCloseTo(9.2)
    expect(result.data.totals.previous).toMatchObject({ clicks: 5, impressions: 100, position: 4 })
    expect(result.data.daily).toHaveLength(2)
    expect(result.data.topQueries).toHaveLength(1)
    expect(result.data.queriesPeriodEnd).toBe('2026-10-11')
  })
})
