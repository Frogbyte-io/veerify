import { beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'sk-super-secret-key-1234567890'

const state = vi.hoisted(() => ({
  teamKeys: {} as Record<string, { apiKey: string; keyHint: string } | null>,
  secretsOk: true,
  validate: { ok: true } as { ok: boolean; kind?: string; message?: string },
  validateThrows: null as Error | null,
  crawlValidate: { ok: true } as { ok: boolean; kind?: string; message?: string },
  pagespeed: null as unknown,
  social: { configured: true, error: null as unknown, calls: [] as Array<Record<string, unknown>> },
  google: { config: null as unknown, rows: [] as Array<Record<string, unknown>>, refresh: null as unknown },
  marked: [] as Array<unknown[]>,
  pagespeedKey: '' as string,
  firecrawlEnv: null as null | { apiKey: string; baseUrl: string },
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => state.google.rows }) }) }),
    }),
  },
}))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }))
vi.mock('~/server/utils/marketing-config', () => ({
  marketingConfig: {
    get pagespeedApiKey() {
      return state.pagespeedKey
    },
  },
}))
vi.mock('~/server/utils/team-credentials', () => ({
  getTeamApiKey: vi.fn(async (_t: string, provider: string) => state.teamKeys[provider] ?? null),
  markCredentialValid: vi.fn(async (...args: unknown[]) => void state.marked.push(['valid', ...args])),
  markCredentialInvalid: vi.fn(async (...args: unknown[]) => void state.marked.push(['invalid', ...args])),
}))
vi.mock('~/server/utils/secrets', async () => {
  const actual = await vi.importActual<typeof import('~/server/utils/secrets')>('~/server/utils/secrets')
  return { ...actual, isSecretsConfigured: () => state.secretsOk }
})
vi.mock('~/server/services/llm', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/llm/types')>('~/server/services/llm/types')
  return {
    LlmProviderError: actual.LlmProviderError,
    getLlmProvider: () => ({
      validateKey: async () => {
        if (state.validateThrows) throw state.validateThrows
        return state.validate
      },
    }),
  }
})
vi.mock('~/server/services/crawl', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/crawl/types')>('~/server/services/crawl/types')
  return {
    CrawlProviderError: actual.CrawlProviderError,
    getCrawlProvider: () => ({ validateKey: async () => state.crawlValidate }),
    resolveCrawlConfig: (teamKey: string | null) =>
      teamKey ? { apiKey: teamKey, baseUrl: 'https://x' } : state.firecrawlEnv,
  }
})
vi.mock('~/server/services/marketing/pagespeed', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/marketing/pagespeed')>(
    '~/server/services/marketing/pagespeed'
  )
  return {
    PageSpeedError: actual.PageSpeedError,
    runPageSpeed: vi.fn(async () => {
      if (state.pagespeed) throw state.pagespeed
      return {}
    }),
  }
})
vi.mock('~/server/services/social-sources', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/social-sources/types')>(
    '~/server/services/social-sources/types'
  )
  return {
    SocialSourceError: actual.SocialSourceError,
    SOCIAL_SOURCES: [],
    getSocialSource: (id: string) => ({
      id,
      label: id,
      isConfigured: () => state.social.configured,
      search: async (input: Record<string, unknown>) => {
        state.social.calls.push(input)
        if (state.social.error) throw state.social.error
        return []
      },
    }),
  }
})
vi.mock('~/server/services/google/search-console', async () => {
  const actual = await vi.importActual<typeof import('~/server/services/google/search-console')>(
    '~/server/services/google/search-console'
  )
  return {
    GoogleApiError: actual.GoogleApiError,
    getGoogleOAuthConfig: () => state.google.config,
    refreshAccessToken: vi.fn(async () => {
      if (state.google.refresh) throw state.google.refresh
      return { accessToken: 'ya29.token', expiresAt: new Date() }
    }),
  }
})

const { runIntegrationTest } = await import('~/server/services/marketing/integration-test')
const { LlmProviderError } = await import('~/server/services/llm/types')
const { PageSpeedError } = await import('~/server/services/marketing/pagespeed')
const { SocialSourceError } = await import('~/server/services/social-sources/types')
const { GoogleApiError } = await import('~/server/services/google/search-console')
const { encryptSecret } = await import('~/server/utils/secrets')

beforeEach(() => {
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  state.teamKeys = {}
  state.secretsOk = true
  state.validate = { ok: true }
  state.validateThrows = null
  state.crawlValidate = { ok: true }
  state.pagespeed = null
  state.social = { configured: true, error: null, calls: [] }
  state.google = { config: null, rows: [], refresh: null }
  state.marked = []
  state.pagespeedKey = ''
  state.firecrawlEnv = null
})

const withKey = (provider: string) => (state.teamKeys[provider] = { apiKey: SECRET, keyHint: '7890' })

describe('secrets', () => {
  it('round-trips with AAD and reports no network', async () => {
    const r = await runIntegrationTest('t1', 'secrets')
    expect(r).toMatchObject({ id: 'secrets', ok: true, source: 'instance' })
    expect(r.detail).toContain('no network')
    expect(typeof r.durationMs).toBe('number')
  })

  it('fails with the env var to set when not configured', async () => {
    state.secretsOk = false
    const r = await runIntegrationTest('t1', 'secrets')
    expect(r).toMatchObject({ ok: false, source: null })
    expect(r.detail).toContain('SECRETS_ENCRYPTION_KEY')
  })

  it('fails when decryption cannot work', async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'not-a-key')
    state.secretsOk = true
    expect((await runIntegrationTest('t1', 'secrets')).ok).toBe(false)
  })
})

describe('LLM providers', () => {
  it('marks the credential valid on success, guarded by the key hint', async () => {
    withKey('anthropic')
    const r = await runIntegrationTest('t1', 'anthropic')
    expect(r).toMatchObject({ ok: true, source: 'team' })
    expect(state.marked).toEqual([['valid', 't1', 'anthropic', '7890']])
  })

  it('marks invalid on an auth failure', async () => {
    withKey('openai')
    state.validate = { ok: false, kind: 'auth', message: `bad key ${SECRET}` }
    const r = await runIntegrationTest('t1', 'openai')
    expect(r).toMatchObject({ ok: false, source: 'team' })
    expect(r.detail).toMatch(/rejected/)
    expect(state.marked[0].slice(0, 3)).toEqual(['invalid', 't1', 'openai'])
    expect(state.marked[0][4]).toBe('7890')
    expect(JSON.stringify([r, state.marked])).not.toContain(SECRET)
  })

  it('does not change status for quota, rate limit or network failures', async () => {
    withKey('gemini')
    for (const kind of ['quota', 'rate_limit', 'network']) {
      state.validate = { ok: false, kind }
      const r = await runIntegrationTest('t1', 'gemini')
      expect(r.ok).toBe(false)
    }
    expect(state.marked).toEqual([])
  })

  it('maps thrown provider errors without leaking their message', async () => {
    withKey('perplexity')
    state.validateThrows = new LlmProviderError('perplexity', 'auth', `Incorrect key ${SECRET}`, 401)
    const r = await runIntegrationTest('t1', 'perplexity')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(SECRET)
    expect(state.marked[0][0]).toBe('invalid')
  })

  it('is not configured without a team key', async () => {
    const r = await runIntegrationTest('t1', 'anthropic')
    expect(r).toMatchObject({ ok: false, source: null, detail: 'Add your Anthropic API key.' })
    expect(state.marked).toEqual([])
  })
})

describe('firecrawl', () => {
  it('validates the team key', async () => {
    withKey('firecrawl')
    const r = await runIntegrationTest('t1', 'firecrawl')
    expect(r).toMatchObject({ ok: true, source: 'team' })
    expect(state.marked[0][0]).toBe('valid')
  })

  it('validates the instance key without touching credential rows', async () => {
    state.firecrawlEnv = { apiKey: 'env', baseUrl: 'https://x' }
    const r = await runIntegrationTest('t1', 'firecrawl')
    expect(r).toMatchObject({ ok: true, source: 'instance' })
    expect(state.marked).toEqual([])
  })

  it('reports auth failures and marks the team key invalid', async () => {
    withKey('firecrawl')
    state.crawlValidate = { ok: false, kind: 'auth' }
    const r = await runIntegrationTest('t1', 'firecrawl')
    expect(r.ok).toBe(false)
    expect(state.marked[0][0]).toBe('invalid')
  })

  it('is not configured with neither key', async () => {
    const r = await runIntegrationTest('t1', 'firecrawl')
    expect(r).toMatchObject({ ok: false, source: null })
    expect(r.detail).toContain('FIRECRAWL_API_KEY')
  })
})

describe('pagespeed', () => {
  it('uses the team key and notes the quota use', async () => {
    withKey('pagespeed')
    const r = await runIntegrationTest('t1', 'pagespeed')
    expect(r).toMatchObject({ ok: true, source: 'team' })
    expect(r.detail).toContain('https://example.com')
    expect(r.detail).toContain('quota')
    expect(state.marked[0][0]).toBe('valid')
  })

  it('falls back to the instance key', async () => {
    state.pagespeedKey = 'env-key'
    expect(await runIntegrationTest('t1', 'pagespeed')).toMatchObject({ ok: true, source: 'instance' })
  })

  it('marks invalid on auth failure, not on quota', async () => {
    withKey('pagespeed')
    state.pagespeed = new PageSpeedError('quota', `quota for ${SECRET}`)
    const quota = await runIntegrationTest('t1', 'pagespeed')
    expect(quota.detail).toMatch(/quota/)
    expect(state.marked).toEqual([])
    state.pagespeed = new PageSpeedError('auth', 'rejected')
    await runIntegrationTest('t1', 'pagespeed')
    expect(state.marked[0][0]).toBe('invalid')
  })

  it('is not configured without any key', async () => {
    const r = await runIntegrationTest('t1', 'pagespeed')
    expect(r).toMatchObject({ ok: false, source: null })
    expect(r.detail).toContain('PAGESPEED_API_KEY')
  })
})

describe('social sources', () => {
  it('queries Hacker News with limit 1, one day back and the veerify term', async () => {
    const before = Date.now()
    const r = await runIntegrationTest('t1', 'hackernews')
    expect(r).toMatchObject({ ok: true, source: null })
    const call = state.social.calls[0] as { query: string; limit: number; since: Date }
    expect(call.query).toBe('veerify')
    expect(call.limit).toBe(1)
    expect(before - call.since.getTime()).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 5)
  })

  it('reports reddit as an instance integration on success', async () => {
    expect(await runIntegrationTest('t1', 'reddit')).toMatchObject({ ok: true, source: 'instance' })
  })

  it('names the env vars when not configured, without searching', async () => {
    state.social.configured = false
    const r = await runIntegrationTest('t1', 'bluesky')
    expect(r).toMatchObject({ ok: false, source: null })
    expect(r.detail).toContain('BLUESKY_IDENTIFIER')
    expect(state.social.calls).toHaveLength(0)
  })

  it('maps auth and rate limit failures', async () => {
    state.social.error = new SocialSourceError('reddit', 'auth', 'token abc', 401)
    expect((await runIntegrationTest('t1', 'reddit')).detail).toMatch(/rejected/)
    state.social.error = new SocialSourceError('hackernews', 'rate_limit', 'x', 429)
    expect((await runIntegrationTest('t1', 'hackernews')).detail).toMatch(/Rate limited/)
  })
})

describe('google', () => {
  const config = {
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'https://app.example/api/marketing/google/callback',
  }

  it('is not configured without OAuth env vars', async () => {
    const r = await runIntegrationTest('t1', 'google')
    expect(r).toMatchObject({ ok: false, source: null })
    expect(r.detail).toContain('GOOGLE_CLIENT_ID')
  })

  it('checks config and states that no refresh was tried when nothing is connected', async () => {
    state.google.config = config
    const r = await runIntegrationTest('t1', 'google')
    expect(r.ok).toBe(true)
    expect(r.detail).toContain(config.redirectUri)
    expect(r.detail).toContain('no token refresh')
  })

  it('refreshes the token of a connected site', async () => {
    state.google.config = config
    state.google.rows = [{ siteId: 's1', encryptedRefreshToken: encryptSecret('refresh-token', 'gsc:s1') }]
    const r = await runIntegrationTest('t1', 'google')
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('Refreshed the access token for 1 connected site')
    expect(r.detail).toContain('no data fetched')
  })

  it('tells the team to reconnect when the token is revoked', async () => {
    state.google.config = config
    state.google.rows = [{ siteId: 's1', encryptedRefreshToken: encryptSecret('refresh-token', 'gsc:s1') }]
    state.google.refresh = new GoogleApiError('revoked', 'invalid_grant refresh-token')
    const r = await runIntegrationTest('t1', 'google')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('reconnect')
    expect(JSON.stringify(r)).not.toContain('refresh-token')
  })

  it('fails for a token that cannot be decrypted (wrong AAD)', async () => {
    state.google.config = config
    state.google.rows = [{ siteId: 's1', encryptedRefreshToken: encryptSecret('refresh-token', 'gsc:other') }]
    expect((await runIntegrationTest('t1', 'google')).ok).toBe(false)
  })
})
