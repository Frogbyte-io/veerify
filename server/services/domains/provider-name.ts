export type DomainProviderName = 'static-cname' | 'vercel' | 'cloudflare-saas'

export function resolveDomainProviderName(value: unknown): DomainProviderName {
  const provider = String(value || 'static-cname')
    .trim()
    .toLowerCase()
  return provider === 'vercel' || provider === 'cloudflare-saas' ? provider : 'static-cname'
}
