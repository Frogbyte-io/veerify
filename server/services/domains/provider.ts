import { domainToASCII } from 'node:url'

export type DomainDnsRecordType = 'A' | 'AAAA' | 'ALIAS' | 'CNAME' | 'TXT'

export type DomainConnectionStatus = 'dns_required' | 'ownership_verification_required' | 'active' | 'error'

export interface DomainDnsRecord {
  type: DomainDnsRecordType
  name: string
  value: string
}

export interface DomainProviderResult {
  hostname: string
  provider: string
  verified: boolean
  status: DomainConnectionStatus
  dnsRecords: DomainDnsRecord[]
  configuredBy: string | null
  expected: string | null
  resolvedTo: string[]
  message: string | null
  /** Provider-side id (e.g. Cloudflare custom hostname id), persisted to domain.provider_domain_id. */
  providerDomainId?: string | null
}

export interface DomainProviderInput {
  hostname: string
  /** Stored provider id, when known. Providers fall back to the hostname. */
  providerDomainId?: string | null
}

export interface DomainProvider {
  registerProjectDomain(input: DomainProviderInput): Promise<DomainProviderResult>
  getProjectDomainStatus(input: DomainProviderInput): Promise<DomainProviderResult>
  verifyProjectDomain(input: DomainProviderInput): Promise<DomainProviderResult>
  removeProjectDomain(input: DomainProviderInput): Promise<void>
}

export function normalizeDomainHostname(hostname: string): string {
  return domainToASCII(hostname.trim().toLowerCase().replace(/\.$/, ''))
}

export function dedupeDnsRecords(records: DomainDnsRecord[]): DomainDnsRecord[] {
  const seen = new Set<string>()
  const seenCnameHosts = new Set<string>()
  const deduped: DomainDnsRecord[] = []

  for (const record of records) {
    const normalized = {
      type: record.type,
      name: normalizeDomainHostname(record.name),
      value: String(record.value).trim(),
    }
    const key = `${normalized.type}:${normalized.name}:${normalized.value}`
    if (seen.has(key)) continue
    if (normalized.type === 'CNAME' && seenCnameHosts.has(normalized.name)) continue
    seen.add(key)
    if (normalized.type === 'CNAME') {
      seenCnameHosts.add(normalized.name)
    }
    deduped.push(normalized)
  }

  return deduped
}
