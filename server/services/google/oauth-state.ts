import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signed, expiring OAuth `state` for the Google Search Console connect flow.
 * Format: base64url(json).base64url(hmac-sha256). The HMAC key is derived from
 * BETTER_AUTH_SECRET with HKDF (info "gsc-oauth-state"), so it is never the raw secret.
 */

export interface OAuthStatePayload {
  siteId: string
  userId: string
  projectId: string
}

export interface VerifiedOAuthState extends OAuthStatePayload {
  /** Random per-state value; the callback consumes it once (see consumeOAuthNonce) */
  nonce: string
}

export type OAuthStateErrorKind = 'malformed' | 'bad_signature' | 'expired'

export class OAuthStateError extends Error {
  readonly kind: OAuthStateErrorKind
  constructor(kind: OAuthStateErrorKind) {
    super(`Invalid OAuth state: ${kind}`)
    this.name = 'OAuthStateError'
    this.kind = kind
  }
}

const DEFAULT_TTL_MS = 10 * 60 * 1000

function deriveKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  return Buffer.from(hkdfSync('sha256', secret, 'veerify-gsc', 'gsc-oauth-state', 32))
}

function mac(data: string): Buffer {
  return createHmac('sha256', deriveKey()).update(data).digest()
}

export function signOAuthState(payload: OAuthStatePayload, ttlMs = DEFAULT_TTL_MS): string {
  const body = {
    siteId: payload.siteId,
    userId: payload.userId,
    projectId: payload.projectId,
    nonce: randomBytes(16).toString('base64url'),
    exp: Date.now() + ttlMs,
  }
  const data = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${data}.${mac(data).toString('base64url')}`
}

export function verifyOAuthState(state: string): VerifiedOAuthState {
  if (typeof state !== 'string' || state.length > 2048) throw new OAuthStateError('malformed')
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new OAuthStateError('malformed')
  const [data, sig] = parts
  // Compare the canonical base64url text, not decoded bytes: the last
  // character of a 32-byte MAC carries two padding bits, so several spellings
  // decode to the same bytes and would otherwise all be accepted.
  const given = Buffer.from(sig, 'utf8')
  const expected = Buffer.from(mac(data).toString('base64url'), 'utf8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new OAuthStateError('bad_signature')
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    throw new OAuthStateError('malformed')
  }
  const { siteId, userId, projectId, nonce, exp } = parsed ?? {}
  if (
    typeof siteId !== 'string' ||
    typeof userId !== 'string' ||
    typeof projectId !== 'string' ||
    typeof nonce !== 'string' ||
    typeof exp !== 'number'
  ) {
    throw new OAuthStateError('malformed')
  }
  if (Date.now() > exp) throw new OAuthStateError('expired')
  return { siteId, userId, projectId, nonce }
}
