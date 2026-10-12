import { createHmac, hkdfSync } from 'node:crypto'

/**
 * Keyed hash of an email address, used to keep a durable, non-reversible handle for a person after
 * their address is anonymised (suppression, withdraw and dedupe still work, the address is gone).
 *
 * HMAC-SHA256(lowercased trimmed email), keyed by a key derived from BETTER_AUTH_SECRET via HKDF with
 * a fixed `info`, so the key is separate from the one Better-Auth uses. Hashes are never exported or
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

export function hashEmail(email: string): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required to hash email addresses')
  return hashEmailWithSecret(email, secret)
}

export function isRedactedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.startsWith(REDACTED_EMAIL_PREFIX)
}
