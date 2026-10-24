export type DomainProviderName = 'static-cname' | 'cloudflare-saas'

export function resolveDomainProviderName(value: unknown): DomainProviderName {
  const provider = String(value || 'static-cname')
    .trim()
    .toLowerCase()
  return provider === 'cloudflare-saas' ? provider : 'static-cname'
}
