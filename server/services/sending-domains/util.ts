/** Small helpers shared by the sending-domain providers. */

/** Lowercase, trimmed, no trailing dot. Full validation (IDN, suffixes) is the caller's job. */
export function normalizeDomainName(domain: string): string {
  return String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
}

/** Collapse whitespace, cap the length and strip any secret that slipped into provider text. */
export function sanitizeProviderMessage(text: unknown, secrets: string[] = [], maxLength = 500): string {
  let value = typeof text === 'string' ? text : ''
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join('[redacted]')
  }
  value = value.replace(/\s+/g, ' ').trim()
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

/** `Retry-After` in seconds (delta-seconds or HTTP date); undefined when absent or unusable. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!header) return undefined
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - now) / 1000))
}
