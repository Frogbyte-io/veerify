import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'

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
    normalized = `${normalized.slice(0, separator + 1)}${first.toString(16)}:${second.toString(16)}`
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

function wordsToIPv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/** Non-public IPv4: private, loopback, link-local, CGNAT, benchmarking, reserved, multicast, broadcast. */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224 // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255
  )
}

function isPrivateIPv6Words(words: number[]): boolean {
  if (words.length !== 8) return true
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words
  // :: and ::1, plus deprecated IPv4-compatible ::/96 (re-check embedded v4)
  if (words.slice(0, 6).every((word) => word === 0)) return isPrivateIPv4(wordsToIPv4(w6, w7))
  // IPv4-mapped ::ffff:0:0/96
  if ([w0, w1, w2, w3, w4].every((word) => word === 0) && w5 === 0xffff) return isPrivateIPv4(wordsToIPv4(w6, w7))
  // NAT64 64:ff9b::/96 (re-check embedded v4); 64:ff9b:1::/48 is local-use
  if (w0 === 0x64 && w1 === 0xff9b) {
    if (w2 === 1) return true
    if (w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) return isPrivateIPv4(wordsToIPv4(w6, w7))
  }
  // 6to4 2002::/16 embeds the v4 address in words 1-2
  if (w0 === 0x2002) return isPrivateIPv4(wordsToIPv4(w1, w2))
  if ((w0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((w0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((w0 & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if (w0 >> 8 === 0xff) return true // ff00::/8 multicast
  return false
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) {
    const words = parseIPv6Words(address)
    return !words || isPrivateIPv6Words(words)
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
