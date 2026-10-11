import { marketingConfig } from '~/server/utils/marketing-config'
import { listTeamCredentials, type TeamCredentialSummary } from '~/server/utils/team-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { getGoogleOAuthConfig } from '~/server/services/google/search-console'
import { SOCIAL_SOURCES } from '~/server/services/social-sources'

export type IntegrationId =
  | 'secrets'
  | 'firecrawl'
  | 'pagespeed'
  | 'anthropic'
  | 'openai'
  | 'perplexity'
  | 'gemini'
  | 'hackernews'
  | 'reddit'
  | 'bluesky'
  | 'google'

export type IntegrationState = 'ready' | 'not_configured' | 'failing'

export interface IntegrationStatus {
  id: IntegrationId
  label: string
  /** What this integration unlocks, in the product's words */
  capability: string
  state: IntegrationState
  source: 'team' | 'instance' | null
  /** What is wrong or what to set; never contains key material */
  detail: string
}

type CredentialFallback = { configured: boolean; missingHint: string }

function fromCredential(
  base: Pick<IntegrationStatus, 'id' | 'label' | 'capability'>,
  credential: TeamCredentialSummary | undefined,
  fallback: CredentialFallback
): IntegrationStatus {
  if (credential?.status === 'invalid') {
    return {
      ...base,
      state: 'failing',
      source: 'team',
      detail: credential.lastError || 'The provider rejected this key. Replace it with a working one.',
    }
  }
  if (credential) {
    const unchecked =
      credential.status === 'valid'
        ? ''
        : ` (not verified yet${credential.lastError ? `: ${credential.lastError}` : ''})`
    return {
      ...base,
      state: 'ready',
      source: 'team',
      detail: `Team key ending in ${credential.keyHint}${unchecked}`,
    }
  }
  if (fallback.configured) {
    return { ...base, state: 'ready', source: 'instance', detail: 'Provided by this installation' }
  }
  return { ...base, state: 'not_configured', source: null, detail: fallback.missingHint }
}

export const SOCIAL_HINTS: Record<string, string> = {
  reddit: 'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a Reddit API app) on the server.',
  bluesky: 'Set BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD (a Bluesky app password) on the server.',
}

/** Integration status for a team: what works, what is missing, and what to set. */
export async function getIntegrationStatus(teamId: string): Promise<IntegrationStatus[]> {
  const credentials = await listTeamCredentials(teamId)
  const byProvider = new Map(credentials.map((c) => [c.provider, c]))

  const secretsReady = isSecretsConfigured()
  const result: IntegrationStatus[] = [
    {
      id: 'secrets',
      label: 'Key encryption',
      capability: 'Storing your own API keys',
      state: secretsReady ? 'ready' : 'not_configured',
      source: secretsReady ? 'instance' : null,
      detail: secretsReady
        ? 'API keys are encrypted at rest'
        : 'Set SECRETS_ENCRYPTION_KEY (32 random bytes, for example from `openssl rand -base64 32`) on the server to store API keys.',
    },
    fromCredential(
      { id: 'firecrawl', label: 'Firecrawl', capability: 'Full site crawl' },
      byProvider.get('firecrawl'),
      {
        configured: Boolean(marketingConfig.firecrawl.apiKey),
        missingHint:
          'Add a Firecrawl key, or set FIRECRAWL_API_KEY on the server. Without it, audits run in basic mode (home page and site files only).',
      }
    ),
    fromCredential(
      { id: 'pagespeed', label: 'PageSpeed Insights', capability: 'Core Web Vitals' },
      byProvider.get('pagespeed'),
      {
        configured: Boolean(marketingConfig.pagespeedApiKey),
        missingHint: 'Add a PageSpeed Insights key, or set PAGESPEED_API_KEY on the server.',
      }
    ),
    fromCredential(
      { id: 'anthropic', label: 'Anthropic (Claude)', capability: 'AI visibility checks on Claude' },
      byProvider.get('anthropic'),
      { configured: false, missingHint: 'Add your Anthropic API key.' }
    ),
    fromCredential(
      { id: 'openai', label: 'OpenAI', capability: 'AI visibility checks on ChatGPT models' },
      byProvider.get('openai'),
      { configured: false, missingHint: 'Add your OpenAI API key.' }
    ),
    fromCredential(
      { id: 'gemini', label: 'Google Gemini', capability: 'AI visibility checks on Gemini with Google Search' },
      byProvider.get('gemini'),
      { configured: false, missingHint: 'Add your Google Gemini API key.' }
    ),
    fromCredential(
      { id: 'perplexity', label: 'Perplexity', capability: 'AI visibility checks on Perplexity' },
      byProvider.get('perplexity'),
      { configured: false, missingHint: 'Add your Perplexity API key.' }
    ),
  ]

  for (const source of SOCIAL_SOURCES) {
    const configured = source.isConfigured()
    result.push({
      id: source.id,
      label: source.label,
      capability: `Mentions from ${source.label}`,
      state: configured ? 'ready' : 'not_configured',
      source: configured && source.id !== 'hackernews' ? 'instance' : null,
      detail: configured ? 'Available' : (SOCIAL_HINTS[source.id] ?? 'Not configured on this server.'),
    })
  }

  const googleConfig = getGoogleOAuthConfig()
  result.push({
    id: 'google',
    label: 'Search Console',
    capability: 'Search clicks, impressions and queries',
    state: googleConfig ? 'ready' : 'not_configured',
    source: googleConfig ? 'instance' : null,
    detail: googleConfig
      ? `Available. Your Google OAuth app must allow the redirect URI ${googleConfig.redirectUri}`
      : 'Create a Google OAuth app (Web application) with the Search Console API enabled, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server, and add {BETTER_AUTH_URL}/api/marketing/google/callback as an authorized redirect URI.',
  })

  return result
}
