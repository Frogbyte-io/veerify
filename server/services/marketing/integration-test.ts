/**
 * "Test connection" checks for the Marketing integrations. Each check is the
 * cheapest real call that proves the credentials or instance settings work.
 * Results are short and key-free: provider messages are mapped to fixed
 * phrases here and never passed through.
 */

import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { gscConnection, marketingSite, type ApiCredentialProvider } from '~/server/database/schema/marketing'
import { instanceKeysAllowed, marketingConfig } from '~/server/utils/marketing-config'
import { SOCIAL_HINTS, type IntegrationId } from '~/server/utils/marketing-integrations'
import { decryptSecret, encryptSecret, isSecretsConfigured } from '~/server/utils/secrets'
import {
  getTeamApiKey,
  markCredentialInvalid,
  markCredentialValid,
  type TeamApiKey,
} from '~/server/utils/team-credentials'
import { getLlmProvider, LlmProviderError, type LlmProviderId } from '~/server/services/llm'
import { getCrawlProvider, resolveCrawlConfig } from '~/server/services/crawl'
import { CrawlProviderError } from '~/server/services/crawl/types'
import { getSocialSource, SocialSourceError } from '~/server/services/social-sources'
import { PageSpeedError, runPageSpeed } from '~/server/services/marketing/pagespeed'
import { getGoogleOAuthConfig, GoogleApiError, refreshAccessToken } from '~/server/services/google/search-console'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('marketing:integration-test')

export const INTEGRATION_TEST_IDS: readonly IntegrationId[] = [
  'secrets',
  'firecrawl',
  'pagespeed',
  'anthropic',
  'openai',
  'gemini',
  'perplexity',
  'hackernews',
  'reddit',
  'bluesky',
  'google',
]

export function isIntegrationId(value: unknown): value is IntegrationId {
  return typeof value === 'string' && (INTEGRATION_TEST_IDS as readonly string[]).includes(value)
}

export interface IntegrationTestResult {
  id: IntegrationId
  ok: boolean
  durationMs: number
  detail: string
  source: 'team' | 'instance' | null
}

type Outcome = Pick<IntegrationTestResult, 'ok' | 'detail' | 'source'>

const LLM_LABELS: Record<LlmProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  perplexity: 'Perplexity',
}

const MISSING_KEY: Record<string, string> = {
  anthropic: 'Add your Anthropic API key.',
  openai: 'Add your OpenAI API key.',
  gemini: 'Add your Google Gemini API key.',
  perplexity: 'Add your Perplexity API key.',
  // Getters: read the deployment mode at use time, not import time
  get firecrawl() {
    return instanceKeysAllowed()
      ? 'Add a Firecrawl key, or set FIRECRAWL_API_KEY on the server.'
      : 'Bring your own key: add your Firecrawl key.'
  },
  get pagespeed() {
    return instanceKeysAllowed()
      ? 'Add a PageSpeed Insights key, or set PAGESPEED_API_KEY on the server.'
      : 'Bring your own key: add your PageSpeed Insights key.'
  },
}

/** Fixed, key-free phrase for a failure kind from any provider adapter. */
export function failureMessage(kind: string | undefined): string {
  switch (kind) {
    case 'auth':
    case 'revoked':
      return 'The key was rejected (authentication failed).'
    case 'forbidden':
      return 'Access was denied; check the key permissions.'
    case 'quota':
      return 'The account is out of quota or credit.'
    case 'rate_limit':
      return 'Rate limited by the provider; try again later.'
    case 'network':
    case 'timeout':
      return 'Could not reach the provider (network error or timeout).'
    case 'server':
      return 'The provider had an error; try again later.'
    case 'bad_request':
      return 'The provider rejected the test request.'
    default:
      return 'The check failed.'
  }
}

function errorKind(error: unknown): string | undefined {
  if (
    error instanceof LlmProviderError ||
    error instanceof CrawlProviderError ||
    error instanceof SocialSourceError ||
    error instanceof GoogleApiError
  ) {
    return error.kind
  }
  if (error instanceof PageSpeedError) return error.kind === 'failed' ? 'network' : error.kind
  return undefined
}

async function syncCredentialStatus(
  teamId: string,
  provider: ApiCredentialProvider,
  key: TeamApiKey,
  ok: boolean,
  kind: string | undefined
) {
  try {
    if (ok) await markCredentialValid(teamId, provider, key.keyHint)
    else if (kind === 'auth') await markCredentialInvalid(teamId, provider, failureMessage('auth'), key.keyHint)
  } catch (error) {
    logger.warn('Could not update credential status after test', {
      teamId,
      provider,
      error: error instanceof Error ? error.name : 'unknown',
    })
  }
}

function testSecrets(teamId: string): Outcome {
  if (!isSecretsConfigured()) {
    return {
      ok: false,
      source: null,
      detail:
        'SECRETS_ENCRYPTION_KEY is not set or invalid. Set 32 random bytes (for example from `openssl rand -base64 32`) on the server.',
    }
  }
  const aad = `team:${teamId}:integration-test`
  const probe = `probe-${Date.now()}-${Math.random()}`
  try {
    const envelope = encryptSecret(probe, aad)
    const roundTrip = decryptSecret(envelope, aad) === probe
    let wrongAadRejected = false
    try {
      decryptSecret(envelope, `${aad}:other`)
    } catch {
      wrongAadRejected = true
    }
    if (!roundTrip || !wrongAadRejected) {
      return { ok: false, source: 'instance', detail: 'Encryption round trip failed.' }
    }
    return {
      ok: true,
      source: 'instance',
      detail: 'Encrypted and decrypted a test value bound to this team (no network used).',
    }
  } catch {
    return { ok: false, source: 'instance', detail: 'Encryption round trip failed. Check SECRETS_ENCRYPTION_KEY.' }
  }
}

async function testLlm(teamId: string, provider: LlmProviderId): Promise<Outcome> {
  const key = await getTeamApiKey(teamId, provider)
  if (!key) return { ok: false, source: null, detail: MISSING_KEY[provider] }

  let ok = false
  let kind: string | undefined
  try {
    const result = await getLlmProvider(provider).validateKey(key.apiKey, AbortSignal.timeout(20_000))
    ok = result.ok
    kind = result.kind
  } catch (error) {
    kind = errorKind(error) ?? 'network'
  }
  await syncCredentialStatus(teamId, provider, key, ok, kind)
  return ok
    ? { ok: true, source: 'team', detail: `${LLM_LABELS[provider]} accepted the team key (no generation, no cost).` }
    : { ok: false, source: 'team', detail: failureMessage(kind) }
}

async function testFirecrawl(teamId: string): Promise<Outcome> {
  const key = await getTeamApiKey(teamId, 'firecrawl')
  const config = resolveCrawlConfig(key?.apiKey ?? null)
  if (!config) return { ok: false, source: null, detail: MISSING_KEY.firecrawl }
  const source = key ? 'team' : 'instance'

  let ok = false
  let kind: string | undefined
  try {
    const result = await getCrawlProvider('firecrawl').validateKey(config, AbortSignal.timeout(20_000))
    ok = result.ok
    kind = result.kind
  } catch (error) {
    kind = errorKind(error) ?? 'network'
  }
  if (key) await syncCredentialStatus(teamId, 'firecrawl', key, ok, kind)
  return ok
    ? { ok: true, source, detail: `Firecrawl accepted the ${source} key.` }
    : { ok: false, source, detail: failureMessage(kind) }
}

async function testPageSpeed(teamId: string): Promise<Outcome> {
  const key = await getTeamApiKey(teamId, 'pagespeed')
  const apiKey = key?.apiKey || marketingConfig.pagespeedApiKey
  if (!apiKey) return { ok: false, source: null, detail: MISSING_KEY.pagespeed }
  const source = key ? 'team' : 'instance'

  let ok = false
  let kind: string | undefined
  try {
    await runPageSpeed('https://example.com', apiKey, { strategy: 'mobile' })
    ok = true
  } catch (error) {
    kind = errorKind(error) ?? 'network'
  }
  if (key) await syncCredentialStatus(teamId, 'pagespeed', key, ok, kind)
  return ok
    ? {
        ok: true,
        source,
        detail: `Analyzed https://example.com (mobile) with the ${source} key. This used one PageSpeed request from your quota.`,
      }
    : { ok: false, source, detail: failureMessage(kind) }
}

async function testSocial(id: 'hackernews' | 'reddit' | 'bluesky'): Promise<Outcome> {
  const source = getSocialSource(id)
  const reported = id === 'hackernews' ? null : 'instance'
  if (!source || !source.isConfigured()) {
    return { ok: false, source: null, detail: SOCIAL_HINTS[id] ?? 'Not configured on this server.' }
  }
  try {
    await source.search({
      query: 'veerify',
      since: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 1,
      signal: AbortSignal.timeout(20_000),
    })
    return { ok: true, source: reported, detail: `${source.label} search answered (1 result requested).` }
  } catch (error) {
    return { ok: false, source: reported, detail: failureMessage(errorKind(error) ?? 'network') }
  }
}

async function testGoogle(teamId: string): Promise<Outcome> {
  const config = getGoogleOAuthConfig()
  if (!config) {
    return {
      ok: false,
      source: null,
      detail:
        'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BETTER_AUTH_URL on the server, then add {BETTER_AUTH_URL}/api/marketing/google/callback as an authorized redirect URI.',
    }
  }
  const configured = `OAuth app configured; its authorized redirect URI must be ${config.redirectUri}.`

  const connections = await db
    .select({ siteId: gscConnection.siteId, encryptedRefreshToken: gscConnection.encryptedRefreshToken })
    .from(gscConnection)
    .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
    .where(eq(marketingSite.teamId, teamId))
    .limit(5)

  if (connections.length === 0) {
    return {
      ok: true,
      source: 'instance',
      detail: `${configured} No site has connected Search Console yet, so no token refresh was tried.`,
    }
  }

  let refreshed = 0
  let failureKind: string | undefined
  for (const connection of connections) {
    try {
      const refreshToken = decryptSecret(connection.encryptedRefreshToken, `gsc:${connection.siteId}`)
      await refreshAccessToken(config, refreshToken)
      refreshed++
    } catch (error) {
      failureKind = errorKind(error) ?? 'revoked'
    }
  }
  if (refreshed === connections.length) {
    return {
      ok: true,
      source: 'instance',
      detail: `${configured} Refreshed the access token for ${refreshed} connected site${refreshed === 1 ? '' : 's'} (no data fetched).`,
    }
  }
  const reason =
    failureKind === 'revoked' || failureKind === 'auth'
      ? 'Google access was revoked or the stored token is unusable; reconnect Search Console.'
      : failureMessage(failureKind)
  return {
    ok: false,
    source: 'instance',
    detail: `${configured} Token refresh worked for ${refreshed} of ${connections.length} connected sites. ${reason}`,
  }
}

/** Runs the check for one integration. Never throws for provider failures. */
export async function runIntegrationTest(teamId: string, id: IntegrationId): Promise<IntegrationTestResult> {
  const started = Date.now()
  let outcome: Outcome
  try {
    switch (id) {
      case 'secrets':
        outcome = testSecrets(teamId)
        break
      case 'firecrawl':
        outcome = await testFirecrawl(teamId)
        break
      case 'pagespeed':
        outcome = await testPageSpeed(teamId)
        break
      case 'anthropic':
      case 'openai':
      case 'gemini':
      case 'perplexity':
        outcome = await testLlm(teamId, id)
        break
      case 'hackernews':
      case 'reddit':
      case 'bluesky':
        outcome = await testSocial(id)
        break
      case 'google':
        outcome = await testGoogle(teamId)
        break
    }
  } catch (error) {
    logger.warn('Integration test crashed', { teamId, id, error: error instanceof Error ? error.name : 'unknown' })
    outcome = { ok: false, source: null, detail: 'The check failed unexpectedly.' }
  }
  return { id, ...outcome, durationMs: Date.now() - started }
}
