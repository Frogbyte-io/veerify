import { afterEach, describe, expect, it } from 'vitest'
import { marketingConfig } from '../server/utils/marketing-config'

const KEYS = [
  'MARKETING_MAX_AUDIT_PAGES',
  'MARKETING_MANUAL_AUDITS_PER_DAY',
  'FIRECRAWL_API_KEY',
  'FIRECRAWL_API_URL',
  'PAGESPEED_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_USER_AGENT',
  'BLUESKY_IDENTIFIER',
  'BLUESKY_APP_PASSWORD',
  'BETTER_AUTH_URL',
  'SECRETS_ENCRYPTION_KEY',
]
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

function clearAll() {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key)
}

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = original[key]
  }
})

describe('marketingConfig', () => {
  it('applies defaults when nothing is set', () => {
    clearAll()
    expect(marketingConfig.maxAuditPages).toBe(50)
    expect(marketingConfig.manualAuditsPerDay).toBe(3)
    expect(marketingConfig.firecrawl).toEqual({ apiKey: undefined, baseUrl: 'https://api.firecrawl.dev' })
    expect(marketingConfig.pagespeedApiKey).toBeUndefined()
    expect(marketingConfig.secretsConfigured).toBe(false)
  })

  it('clamps and parses maxAuditPages', () => {
    clearAll()
    process.env.MARKETING_MAX_AUDIT_PAGES = '9999'
    expect(marketingConfig.maxAuditPages).toBe(500)
    process.env.MARKETING_MAX_AUDIT_PAGES = '0'
    expect(marketingConfig.maxAuditPages).toBe(1)
    process.env.MARKETING_MAX_AUDIT_PAGES = 'abc'
    expect(marketingConfig.maxAuditPages).toBe(50)
    process.env.MARKETING_MAX_AUDIT_PAGES = '120'
    expect(marketingConfig.maxAuditPages).toBe(120)
  })

  it('reads values lazily on each access', () => {
    clearAll()
    expect(marketingConfig.bluesky).toEqual({ identifier: undefined, appPassword: undefined })
    process.env.BLUESKY_IDENTIFIER = 'me.bsky.social'
    process.env.BLUESKY_APP_PASSWORD = 'pw'
    process.env.REDDIT_CLIENT_ID = 'id'
    process.env.FIRECRAWL_API_URL = 'https://fc.internal'
    expect(marketingConfig.bluesky).toEqual({ identifier: 'me.bsky.social', appPassword: 'pw' })
    expect(marketingConfig.reddit.clientId).toBe('id')
    expect(marketingConfig.firecrawl.baseUrl).toBe('https://fc.internal')
  })

  it('builds the bot user agent and secrets flag', () => {
    clearAll()
    process.env.BETTER_AUTH_URL = 'https://app.veerify.com'
    process.env.SECRETS_ENCRYPTION_KEY = 'x'
    expect(marketingConfig.botUserAgent).toBe('VeerifyBot/1.0 (+https://app.veerify.com/bot)')
    expect(marketingConfig.secretsConfigured).toBe(true)
  })
})
