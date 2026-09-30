import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./]

function parseIPv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase()
  const dottedTail = normalized.includes('.')

  if (dottedTail) {
    const separator = normalized.lastIndexOf(':')
    if (separator < 0) return null
    const octets = normalized.slice(separator + 1).split('.')
    if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return null
    const first = (Number(octets[0]) << 8) | Number(octets[1])
    const second = (Number(octets[2]) << 8) | Number(octets[3])
    normalized = `${normalized.slice(0, separator)}${first.toString(16)}:${second.toString(16)}`
  }

  const sections = normalized.split('::')
  if (sections.length > 2) return null

  const parseSection = (section: string): number[] | null => {
    if (!section) return []
    const words = section.split(':')
    if (words.some((word) => !/^[\da-f]{1,4}$/.test(word))) return null
    return words.map((word) => Number.parseInt(word, 16))
  }

  const left = parseSection(sections[0] || '')
  const right = sections.length === 2 ? parseSection(sections[1] || '') : []
  if (!left || !right) return null
  if (left.length + right.length > 8 || (sections.length === 1 && left.length !== 8)) return null

  const zeroes = sections.length === 2 ? 8 - left.length - right.length : 0
  if (sections.length === 2 && zeroes < 1) return null
  return [...left, ...Array.from({ length: zeroes }, () => 0), ...right]
}

function mappedIPv4Address(address: string): string | null {
  const words = parseIPv6Words(address)
  if (!words || words.length !== 8 || !words.slice(0, 5).every((word) => word === 0) || words[5] !== 0xffff) {
    return null
  }
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.')
}

function isPrivateAddress(address: string): boolean {
  const mappedIpv4 = mappedIPv4Address(address)
  if (mappedIpv4) return isPrivateAddress(mappedIpv4)
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

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '')
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
  const hostname = normalizedHostname(url.hostname)
  if (isPrivateAddress(hostname) || isLocalHostname(hostname))
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
  const hostname = normalizedHostname(url.hostname)
  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Webhook URL must not resolve to a private or local address')
    }
  }
  return normalized
}

/** POST JSON through a resolver pinned to the addresses checked above. */
export async function postWebhookJson(value: string, body: unknown, timeoutMs = 10_000): Promise<number> {
  const normalized = validateWebhookUrlSyntax(value)
  const url = new URL(normalized)
  const hostname = normalizedHostname(url.hostname)
  const family = isIP(hostname)
  let address = hostname
  let addressFamily = family
  if (!family) {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.some(({ address: candidate }) => isPrivateAddress(candidate))) {
      throw new Error('Webhook URL must not resolve to a private or local address')
    }
    address = addresses[0]?.address || ''
    addressFamily = addresses[0]?.family || 0
  }
  if (!address || !addressFamily) throw new Error('Webhook hostname did not resolve')

  const payload = JSON.stringify(body)
  const transport = url.protocol === 'https:' ? https : http
  return await new Promise<number>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        servername: family ? undefined : hostname,
        lookup: (_host, _options, callback) => callback(null, address, addressFamily as 4 | 6),
      },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      }
    )
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Webhook request timed out')))
    request.on('error', reject)
    request.end(payload)
  })
}
