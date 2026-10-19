import { createHmac, hkdfSync } from 'node:crypto'

/**
 * Keyed hash of an email address, used to keep a durable, non-reversible handle for a person after
 * their address is anonymised (suppression, withdraw and dedupe still work, the address is gone).
 *
 * HMAC-SHA256(lowercased trimmed email), keyed by a key derived via HKDF with a fixed `info` from
 * MARKETING_EMAIL_HASH_KEY (preferred: set once, never rotate) or else BETTER_AUTH_SECRET, so the key is
 * separate from the one Better-Auth uses. Rotating BETTER_AUTH_SECRET keeps old hashes matching while
 * BETTER_AUTH_SECRET_PREV is set (lookups try all candidates). Hashes are never exported or
 * returned by any API.
 */

const INFO = 'marketing-email-hash'

/** Placeholder stored in `email` columns once a row is anonymised. Unique per row/hash, never a valid address. */
export const REDACTED_EMAIL_PREFIX = 'redacted:'

export function normalizeMarketingEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function deriveEmailHashKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', INFO, 32))
}

export function hashEmailWithSecret(email: string, secret: string): string {
  return createHmac('sha256', deriveEmailHashKey(secret)).update(normalizeMarketingEmail(email)).digest('hex')
}

/** Same dev default as lib/auth.ts, so hashing keeps working where auth does (never in production). */
const DEV_FALLBACK_SECRET = 'veerify-dev-auth-secret-v1'

function authSecret(): string | null {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : DEV_FALLBACK_SECRET)
  return secret || null
}

/** Secrets the hash key may be derived from, primary first. Writes use the first; lookups try all. */
function hashSecrets(): string[] {
  const dedicated = process.env.MARKETING_EMAIL_HASH_KEY || null
  const auth = authSecret()
  const prev = process.env.BETTER_AUTH_SECRET_PREV || null
  const all = [dedicated, auth, prev].filter((value): value is string => Boolean(value))
  if (!all.length) throw new Error('MARKETING_EMAIL_HASH_KEY or BETTER_AUTH_SECRET is required to hash email addresses')
  return [...new Set(all)]
}

/** The hash stored on every write: keyed by MARKETING_EMAIL_HASH_KEY when set, else by BETTER_AUTH_SECRET. */
export function hashEmail(email: string): string {
  return hashEmailWithSecret(email, hashSecrets()[0]!)
}

/**
 * Every hash an address may be stored under: the primary one plus hashes under the other configured
 * secrets (BETTER_AUTH_SECRET when a dedicated key is set, BETTER_AUTH_SECRET_PREV after a rotation).
 * Use for every lookup by hash, so rows written before a rotation or before the dedicated key was
 * introduced keep matching. Never use for writes.
 */
export function hashEmailCandidates(email: string): string[] {
  return [...new Set(hashSecrets().map((secret) => hashEmailWithSecret(email, secret)))]
}

export function isRedactedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.startsWith(REDACTED_EMAIL_PREFIX)
}
