import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ credentials: [] as Array<Record<string, unknown>> }))

vi.mock('~/server/utils/team-credentials', () => ({
  listTeamCredentials: vi.fn(async () => state.credentials),
}))
vi.mock('~/server/utils/secrets', () => ({ isSecretsConfigured: () => true }))

const { instanceKeysAllowed, isCloudDeployment, marketingConfig } = await import('~/server/utils/marketing-config')
const { resolveCrawlConfig } = await import('~/server/services/crawl')
const { getIntegrationStatus } = await import('~/server/utils/marketing-integrations')

beforeEach(() => {
  state.credentials = []
  for (const key of ['APP_DEPLOYMENT_MODE', 'MARKETING_ALLOW_INSTANCE_KEYS', 'VERCEL', 'VERCEL_ENV']) {
    vi.stubEnv(key, '')
  }
  vi.stubEnv('FIRECRAWL_API_KEY', 'instance-fc')
  vi.stubEnv('PAGESPEED_API_KEY', 'instance-psi')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('deployment mode', () => {
  it('detects cloud from APP_DEPLOYMENT_MODE, self-hosted otherwise, Vercel only when unset', () => {
    expect(isCloudDeployment()).toBe(false)
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    expect(isCloudDeployment()).toBe(true)
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('VERCEL', '1')
    expect(isCloudDeployment()).toBe(false)
    vi.stubEnv('APP_DEPLOYMENT_MODE', '')
    expect(isCloudDeployment()).toBe(true)
  })
})

describe('instance key guard', () => {
  it('uses instance keys self-hosted', () => {
    expect(instanceKeysAllowed()).toBe(true)
    expect(marketingConfig.firecrawl.apiKey).toBe('instance-fc')
    expect(marketingConfig.pagespeedApiKey).toBe('instance-psi')
    expect(resolveCrawlConfig(null)).toMatchObject({ apiKey: 'instance-fc' })
  })

  it('ignores the instance Firecrawl and PageSpeed keys on the cloud', () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    expect(instanceKeysAllowed()).toBe(false)
    expect(marketingConfig.firecrawl.apiKey).toBeUndefined()
    expect(marketingConfig.pagespeedApiKey).toBeUndefined()
    expect(resolveCrawlConfig(null)).toBeNull()
  })

  it('still honours a team key on the cloud', () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    expect(resolveCrawlConfig('team-key')).toMatchObject({ apiKey: 'team-key' })
  })

  it('MARKETING_ALLOW_INSTANCE_KEYS=true re-enables the fallbacks on the cloud', () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('MARKETING_ALLOW_INSTANCE_KEYS', 'true')
    expect(instanceKeysAllowed()).toBe(true)
    expect(marketingConfig.firecrawl.apiKey).toBe('instance-fc')
    expect(marketingConfig.pagespeedApiKey).toBe('instance-psi')
    expect(resolveCrawlConfig(null)).toMatchObject({ apiKey: 'instance-fc' })
  })

  it('only the literal "true" opens it', () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('MARKETING_ALLOW_INSTANCE_KEYS', '1')
    expect(instanceKeysAllowed()).toBe(false)
  })
})

describe('integration status on the cloud', () => {
  it('shows "Bring your own key" instead of the instance fallback, even when the env keys are set', async () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    const status = Object.fromEntries((await getIntegrationStatus('t1')).map((i) => [i.id, i]))
    expect(status.firecrawl).toMatchObject({ state: 'not_configured', source: null })
    expect(status.firecrawl.detail).toContain('Bring your own key')
    expect(status.firecrawl.detail).not.toContain('FIRECRAWL_API_KEY')
    expect(status.pagespeed).toMatchObject({ state: 'not_configured' })
    expect(status.pagespeed.detail).toContain('Bring your own key')
  })

  it('a team key still reports ready on the cloud', async () => {
    vi.stubEnv('APP_DEPLOYMENT_MODE', 'cloud')
    state.credentials = [{ provider: 'firecrawl', keyHint: 'wxyz', status: 'valid', lastError: null }]
    const status = Object.fromEntries((await getIntegrationStatus('t1')).map((i) => [i.id, i]))
    expect(status.firecrawl).toMatchObject({ state: 'ready', source: 'team' })
  })

  it('self-hosted keeps reporting the instance key', async () => {
    const status = Object.fromEntries((await getIntegrationStatus('t1')).map((i) => [i.id, i]))
    expect(status.firecrawl).toMatchObject({ state: 'ready', source: 'instance' })
  })
})
