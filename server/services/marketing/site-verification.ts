import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { getDomain, parse } from 'tldts'
import { safeFetchText } from '~/server/utils/safe-fetch'

export type VerificationMethod = 'dns' | 'meta' | 'file'

export class SiteOriginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteOriginError'
  }
}

/** Accepts bare domains or URLs; returns `https://host`. Explicit ports other than 443 are rejected. */
export function normalizeSiteOrigin(input: string): string {
  const raw = (input || '').trim()
  if (!raw) throw new SiteOriginError('Enter your site address, for example example.com')
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new SiteOriginError('That does not look like a valid site address')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SiteOriginError('Only http and https addresses are supported')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const parsed = parse(hostname)
  if (parsed.isIp || hostname.startsWith('[')) {
    throw new SiteOriginError('Use a domain name, not an IP address')
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SiteOriginError('Local addresses cannot be verified')
  }
  if (!parsed.domain || !parsed.isIcann) {
    throw new SiteOriginError('Use a public domain name, for example example.com')
  }
  // `new URL` drops default ports (http :80), so inspect the raw authority
  const explicitPort = /^[a-z][a-z\d+.-]*:\/\/[^/?#@]*?(?::(\d+))?(?:[/?#]|$)/i.exec(withScheme)?.[1]
  if ((explicitPort && explicitPort !== '443') || (url.port && url.port !== '443')) {
    throw new SiteOriginError(
      'Custom ports are not supported. Use your site address without a port, for example example.com'
    )
  }
  return `https://${hostname}`
}

export function generateVerificationToken(): string {
  return randomBytes(24).toString('base64url')
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  if (!match) return null
  return (match[1] ?? match[2] ?? match[3] ?? '').trim()
}

function metaTagMatches(html: string, token: string): boolean {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  return tags.some(
    (tag) => attr(tag, 'name')?.toLowerCase() === 'veerify-site-verification' && attr(tag, 'content') === token
  )
}

export async function checkVerification(
  origin: string,
  token: string,
  method: VerificationMethod
): Promise<{ verified: boolean; detail: string }> {
  const url = new URL(origin)
  if (!token) return { verified: false, detail: 'Missing verification token' }

  if (method === 'dns') {
    const expected = `veerify-site-verification=${token}`
    for (const name of [url.hostname, `_veerify.${url.hostname}`]) {
      try {
        const records = await resolveTxt(name)
        if (records.some((chunks) => chunks.join('').trim() === expected)) {
          return { verified: true, detail: `TXT record found on ${name}` }
        }
      } catch {
        // NXDOMAIN / no data on this name; try the next
      }
    }
    return {
      verified: false,
      detail: `No matching TXT record found on ${url.hostname}. DNS changes can take a while to propagate.`,
    }
  }

  try {
    if (method === 'meta') {
      const result = await safeFetchText(`${url.origin}/`, { accept: 'text/html,*/*;q=0.5' })
      if (result.status >= 400) return { verified: false, detail: `Home page returned HTTP ${result.status}` }
      return metaTagMatches(result.body, token)
        ? { verified: true, detail: 'Meta tag found on the home page' }
        : { verified: false, detail: 'Meta tag not found on the home page' }
    }
    const result = await safeFetchText(`${url.origin}/.well-known/veerify-verification.txt`, {
      accept: 'text/plain,*/*;q=0.5',
      maxBytes: 4096,
    })
    if (result.status !== 200) return { verified: false, detail: `Verification file returned HTTP ${result.status}` }
    return result.body.trim() === token
      ? { verified: true, detail: 'Verification file found' }
      : { verified: false, detail: 'Verification file does not contain the expected token' }
  } catch (error) {
    // Deliberately generic: never reflect resolver/network error text back to the caller
    return { verified: false, detail: 'Could not reach your site over HTTPS' }
  }
}

/**
 * True when the origin is proven by an active project domain: the same host, or
 * the registrable domain (optionally with `www.`) of an active hostname.
 * Registrable domains use the public suffix list including private suffixes, so
 * `a.github.io` never covers `b.github.io` or `github.io`.
 */
export function isCoveredByVerifiedDomain(origin: string, verifiedDomains: string[]): boolean {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  return verifiedDomains.some((domain) => {
    const active = domain.trim().toLowerCase().replace(/\.$/, '')
    if (!active) return false
    if (active === host) return true
    const registrable = getDomain(active, { allowPrivateDomains: true })
    if (!registrable) return false
    return host === registrable || host === `www.${registrable}`
  })
}
