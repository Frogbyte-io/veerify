/**
 * Instance-level Marketing configuration. Every value is read from
 * `process.env` on access (never at import time) so tests and runtime config
 * changes see current values. Team-supplied keys live in `team_api_credential`,
 * not here.
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(readEnv(name) ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const marketingConfig = {
  /** Hard cap on pages per audit (1..500). */
  get maxAuditPages() {
    return readInt('MARKETING_MAX_AUDIT_PAGES', 50, 1, 500)
  },
  /** Manual audits a product may start per day. */
  get manualAuditsPerDay() {
    return readInt('MARKETING_MANUAL_AUDITS_PER_DAY', 3, 0, 1000)
  },
  get firecrawl() {
    return {
      apiKey: readEnv('FIRECRAWL_API_KEY'),
      baseUrl: readEnv('FIRECRAWL_API_URL') ?? 'https://api.firecrawl.dev',
    }
  },
  get pagespeedApiKey() {
    return readEnv('PAGESPEED_API_KEY')
  },
  get reddit() {
    return {
      clientId: readEnv('REDDIT_CLIENT_ID'),
      clientSecret: readEnv('REDDIT_CLIENT_SECRET'),
      userAgent: readEnv('REDDIT_USER_AGENT'),
    }
  },
  get bluesky() {
    return {
      identifier: readEnv('BLUESKY_IDENTIFIER'),
      appPassword: readEnv('BLUESKY_APP_PASSWORD'),
    }
  },
  /** User agent for outbound audit fetches; the /bot page explains the crawler. */
  get botUserAgent() {
    return `VeerifyBot/1.0 (+${readEnv('BETTER_AUTH_URL') ?? ''}/bot)`
  },
  /** Whether team API keys can be encrypted at rest on this instance. */
  get secretsConfigured() {
    return readEnv('SECRETS_ENCRYPTION_KEY') !== undefined
  },
}
