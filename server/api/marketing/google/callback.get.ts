/**
 * @openapi
 * /api/marketing/google/callback:
 *   get:
 *     tags: [Marketing]
 *     summary: Google OAuth callback for Search Console
 *     description: >
 *       Registered as the redirect URI in the Google OAuth app. Requires the session of the user who
 *       started the flow. Stores the encrypted refresh token and redirects to the Search page with
 *       `connected=1` or `error=<code>`. Tokens never appear in a URL or response.
 *     operationId: googleSearchCallback
 *     parameters:
 *       - { in: query, name: code, schema: { type: string } }
 *       - { in: query, name: state, schema: { type: string } }
 *       - { in: query, name: error, schema: { type: string } }
 *     responses:
 *       302: { description: Redirect to the Search page }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { OAuthStateError, verifyOAuthState, type VerifiedOAuthState } from '~/server/services/google/oauth-state'
import {
  exchangeCode,
  getGoogleOAuthConfig,
  GoogleApiError,
  listSites,
  matchPropertyForOrigin,
  type GscSite,
} from '~/server/services/google/search-console'
import {
  consumeOAuthNonce,
  gscAad,
  revokeReplacedToken,
  saveGscConnection,
} from '~/server/services/marketing/search/connection'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { findMarketingSite } from '~/server/utils/marketing-site'
import { encryptSecret, isSecretsConfigured } from '~/server/utils/secrets'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('marketing-search')

function back(event: Parameters<typeof sendRedirect>[0], params: Record<string, string>, slug?: string | null) {
  const query = new URLSearchParams(slug ? { product: slug, ...params } : params)
  return sendRedirect(event, `/marketing/search?${query.toString()}`, 302)
}

async function slugFor(projectId: string): Promise<string | null> {
  const [row] = await db.select({ slug: project.slug }).from(project).where(eq(project.id, projectId)).limit(1)
  return row?.slug ?? null
}

export default defineEventHandler(async (event) => {
  let session
  try {
    session = await requireAuth(event)
  } catch {
    return sendRedirect(event, '/login', 302)
  }

  const query = getQuery(event)
  const str = (value: unknown) => (typeof value === 'string' ? value : '')

  let state: VerifiedOAuthState
  try {
    state = verifyOAuthState(str(query.state))
  } catch (error) {
    return back(event, {
      error: error instanceof OAuthStateError && error.kind === 'expired' ? 'expired_state' : 'invalid_state',
    })
  }

  if (state.userId !== session.user.id) return back(event, { error: 'user_mismatch' })

  const slug = await slugFor(state.projectId)
  let teamId: string
  try {
    ;({ teamId } = await requireMarketingAdmin(state.projectId, session.user.id))
  } catch {
    return back(event, { error: 'forbidden' }, slug)
  }

  // Single-use state: a replayed callback URL (history, logs, referrer) is rejected
  if (!(await consumeOAuthNonce(teamId, state.nonce))) return back(event, { error: 'invalid_state' }, slug)

  if (str(query.error)) {
    return back(event, { error: str(query.error) === 'access_denied' ? 'access_denied' : 'google_error' }, slug)
  }
  const code = str(query.code)
  if (!code) return back(event, { error: 'invalid_state' }, slug)

  const config = getGoogleOAuthConfig()
  if (!config || !isSecretsConfigured()) return back(event, { error: 'not_configured' }, slug)

  const site = await findMarketingSite(state.projectId)
  if (!site || site.id !== state.siteId || !site.verifiedAt) return back(event, { error: 'site_changed' }, slug)

  let tokens
  try {
    tokens = await exchangeCode(config, code)
  } catch (error) {
    logger.warn('Search Console code exchange failed', {
      kind: error instanceof GoogleApiError ? error.kind : 'unknown',
    })
    return back(event, { error: 'exchange_failed' }, slug)
  }

  let sites: GscSite[] = []
  try {
    sites = await listSites(tokens.accessToken)
  } catch {
    // The user can pick a property later; the properties endpoint retries the call.
    sites = []
  }
  const match = matchPropertyForOrigin(site.origin, sites)

  const now = new Date()
  const values = {
    encryptedRefreshToken: encryptSecret(tokens.refreshToken, gscAad(site.id)),
    googleAccountEmail: tokens.email,
    propertyUrl: match?.siteUrl ?? null,
    status: match ? ('connected' as const) : ('needs_property' as const),
    // Null lastSyncAt queues an immediate sync for the next task tick
    lastSyncAt: null,
    lastError: null,
    connectedByUserId: session.user.id,
    updatedAt: now,
  }
  // Drops the old property's metrics in the same transaction when the property differs
  const { previousEncryptedToken } = await saveGscConnection(site.id, values, now)
  // The replaced token would otherwise stay valid at Google; best effort, never blocks the reconnect
  await revokeReplacedToken(site.id, previousEncryptedToken, tokens.refreshToken)

  return back(event, { connected: '1' }, slug)
})
