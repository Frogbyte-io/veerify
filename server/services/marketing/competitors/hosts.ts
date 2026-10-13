import { getDomain } from 'tldts'

/** Lower-case, no trailing dot (`rival.com.` is the same host as `rival.com`), no leading `www.`. */
export function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '')
}

/** Lower-case host without trailing dots, keeping `www.`: the identity of a host for redirects and caches. */
export function canonicalHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '')
}

/**
 * True when the domain is a public suffix on its own (`github.io`, `vercel.app`, `co.uk`):
 * owning such a "domain" says nothing about who runs a page on it.
 */
export function isPublicSuffixOnly(domain: string): boolean {
  return getDomain(canonicalHost(domain), { allowPrivateDomains: true }) === null
}

/** The host is the competitor domain or one of its subdomains, and the domain is not a bare public suffix. */
export function hostMatchesDomain(host: string, domain: string | null | undefined): boolean {
  if (!domain) return false
  const d = bareHost(domain)
  const h = bareHost(host)
  if (!d || isPublicSuffixOnly(d)) return false
  return h === d || h.endsWith(`.${d}`)
}
