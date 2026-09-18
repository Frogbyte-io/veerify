import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./]

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return PRIVATE_IPV4.some((pattern) => pattern.test(address)) || address === '0.0.0.0'
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  return false
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  )
}

/** Validate the stored form without performing DNS/network I/O. */
export function validateWebhookUrlSyntax(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('A valid webhook URL is required')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error('Webhook URL must be an HTTP(S) URL without credentials')
  }
  if (isPrivateAddress(url.hostname) || isLocalHostname(url.hostname))
    throw new Error('Webhook URL must not target a private or local address')
  return url.toString()
}

export function isPrivateWebhookAddress(address: string): boolean {
  return isPrivateAddress(address)
}

/** Resolve hostnames immediately before delivery to reduce DNS-rebinding SSRF risk. */
export async function validateWebhookUrlForRequest(value: string): Promise<string> {
  const normalized = validateWebhookUrlSyntax(value)
  const url = new URL(normalized)
  if (!isIP(url.hostname)) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Webhook URL must not resolve to a private or local address')
    }
  }
  return normalized
}
