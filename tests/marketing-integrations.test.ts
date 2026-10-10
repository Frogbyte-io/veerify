import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  credentials: [] as Array<Record<string, unknown>>,
  secrets: true,
}))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => state.credentials),
}))
vi.mock('~/server/utils/secrets', () => ({ isSecretsConfigured: () => state.secrets }))

const { getIntegrationStatus } = await import('~/server/utils/marketing-integrations')

const ENV_KEYS = [
  'FIRECRAWL_API_KEY',
  'PAGESPEED_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'BLUESKY_IDENTIFIER',
  'BLUESKY_APP_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'BETTER_AUTH_URL',
]
beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, '')
  state.credentials = []
  state.secrets = true
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const byId = async () => Object.fromEntries((await getIntegrationStatus('t1')).map((i) => [i.id, i]))

const credential = (provider: string, status: string, lastError: string | null = null) => ({
  provider,
  keyHint: 'wxyz',
  status,
  lastError,
})

describe('getIntegrationStatus', () => {
  it('lists every integration with a capability', async () => {
    const all = await getIntegrationStatus('t1')
    expect(all.map((i) => i.id)).toEqual([
      'secrets',
      'firecrawl',
      'pagespeed',
      'anthropic',
      'openai',
      'hackernews',
      'reddit',
      'bluesky',
      'google',
    ])
    expect(all.every((i) => i.capability.length > 0)).toBe(true)
    expect(all.find((i) => i.id === 'firecrawl')?.capability).toBe('Full site crawl')
  })

  it('reports missing key encryption and says what to set', async () => {
    state.secrets = false
    const { secrets } = await byId()
    expect(secrets).toMatchObject({ state: 'not_configured', source: null })
    expect(secrets.detail).toContain('SECRETS_ENCRYPTION_KEY')
  })

  it('marks everything not configured on a bare install, except Hacker News', async () => {
    const i = await byId()
    expect(i.firecrawl.state).toBe('not_configured')
    expect(i.firecrawl.detail).toContain('FIRECRAWL_API_KEY')
    expect(i.pagespeed.state).toBe('not_configured')
    expect(i.anthropic.state).toBe('not_configured')
    expect(i.openai.state).toBe('not_configured')
    expect(i.hackernews).toMatchObject({ state: 'ready', source: null })
    expect(i.reddit.state).toBe('not_configured')
    expect(i.reddit.detail).toContain('REDDIT_CLIENT_ID')
    expect(i.bluesky.state).toBe('not_configured')
  })

  it('reports Search Console readiness from the Google OAuth app', async () => {
    const bare = await byId()
    expect(bare.google).toMatchObject({ label: 'Search Console', state: 'not_configured' })
    expect(bare.google.detail).toContain('GOOGLE_CLIENT_ID')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com')
    const ready = await byId()
    expect(ready.google).toMatchObject({ state: 'ready', source: 'instance' })
    expect(ready.google.detail).toContain('https://app.example.com/api/marketing/google/callback')
    expect(ready.google.detail).not.toContain('secret')
  })

  it('falls back to instance keys for Firecrawl and PageSpeed', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-instance')
    vi.stubEnv('PAGESPEED_API_KEY', 'psi-instance')
    const i = await byId()
    expect(i.firecrawl).toMatchObject({ state: 'ready', source: 'instance' })
    expect(i.pagespeed).toMatchObject({ state: 'ready', source: 'instance' })
  })

  it('prefers a team key over the instance key', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-instance')
    state.credentials = [credential('firecrawl', 'valid')]
    const { firecrawl } = await byId()
    expect(firecrawl).toMatchObject({ state: 'ready', source: 'team' })
    expect(firecrawl.detail).toContain('wxyz')
  })

  it('reports an invalid team key as failing with its error, even with an instance fallback', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-instance')
    state.credentials = [credential('firecrawl', 'invalid', 'Unauthorized')]
    const { firecrawl } = await byId()
    expect(firecrawl).toMatchObject({ state: 'failing', source: 'team', detail: 'Unauthorized' })
  })

  it('treats unchecked LLM keys as ready and never uses an instance fallback for LLMs', async () => {
    state.credentials = [credential('openai', 'unchecked', 'Provider is down')]
    const i = await byId()
    expect(i.openai.state).toBe('ready')
    expect(i.openai.detail).toContain('not verified yet')
    expect(i.anthropic.state).toBe('not_configured')
  })

  it('reports Reddit and Bluesky ready when instance credentials are set', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'secret')
    vi.stubEnv('BLUESKY_IDENTIFIER', 'me.bsky.social')
    vi.stubEnv('BLUESKY_APP_PASSWORD', 'app-pass')
    const i = await byId()
    expect(i.reddit).toMatchObject({ state: 'ready', source: 'instance' })
    expect(i.bluesky).toMatchObject({ state: 'ready', source: 'instance' })
  })

  it('never includes key material in any detail', async () => {
    state.credentials = [credential('anthropic', 'invalid', 'bad key')]
    const all = await getIntegrationStatus('t1')
    expect(JSON.stringify(all)).not.toMatch(/sk-/)
  })
})
