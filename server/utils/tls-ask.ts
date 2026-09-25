/**
 * Pure hostname logic for the Caddy on-demand TLS gate.
 *
 * Split out from the route handler so it can be tested without an H3 event or a
 * database. A bug here is a security bug: too permissive and the deployment
 * becomes an open certificate-issuance relay.
 */

/** Hostname characters only. Rejects anything that could be smuggled elsewhere. */
const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/

/** Longest legal DNS name. */
const MAX_HOSTNAME_LENGTH = 253

/**
 * Normalize and validate a hostname from an untrusted query parameter.
 * Returns null if it is not a plausible DNS name.
 */
export function parseAskHostname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const hostname = raw.trim().toLowerCase().replace(/\.$/, '')

  if (!hostname) return null
  if (hostname.length > MAX_HOSTNAME_LENGTH) return null
  if (!HOSTNAME_PATTERN.test(hostname)) return null
  // Reject empty labels (`a..b`) and leading/trailing dots or hyphens, which are
  // not legal DNS and would otherwise reach the slug logic below.
  if (hostname.startsWith('.') || hostname.startsWith('-')) return null
  if (hostname.includes('..')) return null

  return hostname
}

/**
 * Extract the team slug from a hostname directly under the app domain.
 *
 * Returns null when the hostname is not a single label under `appDomain` — a
 * deeper name like `a.b.veerify.io` is not a team subdomain and must not be
 * treated as one. The caller still has to confirm the team exists; matching the
 * shape alone would mint a certificate for any label.
 */
export function extractTeamSlug(hostname: string, appDomain: string): string | null {
  const suffix = appDomain.trim().toLowerCase()
  if (!suffix) return null
  if (!hostname.endsWith(`.${suffix}`)) return null

  const slug = hostname.slice(0, -(suffix.length + 1))

  if (!slug) return null
  if (slug.includes('.')) return null
  if (slug.startsWith('-') || slug.endsWith('-')) return null

  return slug
}
