import { resolveDomainProviderName } from './provider-name'

type Env = Record<string, string | undefined>
type RuntimeLike = Record<string, unknown>

/**
 * Misconfiguration messages for the selected custom-domain provider.
 * Checks both the plain env vars and the Nuxt runtime config (which the
 * NUXT_-prefixed vars populate for prebuilt images).
 */
export function domainProviderEnvIssues(env: Env, config: RuntimeLike = {}): string[] {
  const provider = resolveDomainProviderName(config.domainProvider || env.NUXT_DOMAIN_PROVIDER || env.DOMAIN_PROVIDER)
  if (provider !== 'cloudflare-saas') return []

  const token = String(config.cloudflareApiToken || env.NUXT_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN || '')
  const zone = String(config.cloudflareZoneId || env.NUXT_CLOUDFLARE_ZONE_ID || env.CLOUDFLARE_ZONE_ID || '')
  const missing = [!token.trim() && 'CLOUDFLARE_API_TOKEN', !zone.trim() && 'CLOUDFLARE_ZONE_ID'].filter(Boolean)
  if (missing.length === 0) return []

  return [
    `DOMAIN_PROVIDER=cloudflare-saas but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. Custom domain registration will fail until they are configured.`,
  ]
}
