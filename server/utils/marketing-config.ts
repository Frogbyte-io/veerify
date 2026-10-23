/**
 * Instance-level Marketing configuration. Every value is read from
 * `process.env` on access (never at import time) so tests and runtime config
 * changes see current values. Workspace-supplied keys live in `organization_api_credential`,
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

/**
 * Whether this deployment is the multi-tenant cloud. Mirrors the detection in
 * `server/services/scheduler/index.ts` and `nuxt.config.ts`: `APP_DEPLOYMENT_MODE` wins when set to a
 * recognized value, otherwise Vercel's own env vars imply cloud.
 */
export function isCloudDeployment(): boolean {
  const configured = (readEnv('APP_DEPLOYMENT_MODE') ?? '').toLowerCase()
  if (configured === 'cloud') return true
  if (configured === 'self-hosted') return false
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
}

/**
 * Whether instance-wide Firecrawl / PageSpeed keys may serve every workspace. Always true self-hosted. On
 * the cloud an instance key would give every workspace free crawling at the operator's expense, so it is
 * ignored unless `MARKETING_ALLOW_INSTANCE_KEYS=true` (until billing entitlements exist).
 */
export function instanceKeysAllowed(): boolean {
  if (!isCloudDeployment()) return true
  return (readEnv('MARKETING_ALLOW_INSTANCE_KEYS') ?? '').toLowerCase() === 'true'
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
      apiKey: instanceKeysAllowed() ? readEnv('FIRECRAWL_API_KEY') : undefined,
      baseUrl: readEnv('FIRECRAWL_API_URL') ?? 'https://api.firecrawl.dev',
    }
  },
  get pagespeedApiKey() {
    return instanceKeysAllowed() ? readEnv('PAGESPEED_API_KEY') : undefined
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
  /** Concurrent AI visibility answers per tick, across providers (1..50, default 24). */
  get visibilityConcurrency() {
    return readInt('MARKETING_VISIBILITY_CONCURRENCY', 24, 1, 50)
  },
  /** Concurrent AI visibility answers per LLM provider (1..20, default 8). */
  get visibilityProviderConcurrency() {
    return readInt('MARKETING_VISIBILITY_PROVIDER_CONCURRENCY', 8, 1, 20)
  },
  /** Pending visibility answers above which weekly runs stop being scheduled (100..100000, default 5000). */
  get visibilityBacklogLimit() {
    return readInt('MARKETING_VISIBILITY_BACKLOG_LIMIT', 5000, 100, 100_000)
  },
  /** Sites polled at the same time by the mentions poller (1..32, default 16); each polls its sources in parallel. */
  get mentionsConcurrency() {
    return readInt('MARKETING_MENTIONS_CONCURRENCY', 16, 1, 32)
  },
  /** Whether workspace API keys can be encrypted at rest on this instance. */
  get secretsConfigured() {
    return readEnv('SECRETS_ENCRYPTION_KEY') !== undefined
  },
}
