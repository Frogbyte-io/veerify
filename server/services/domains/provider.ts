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
}

export interface DomainProvider {
  registerProjectDomain(input: { hostname: string }): Promise<DomainProviderResult>
  getProjectDomainStatus(input: { hostname: string }): Promise<DomainProviderResult>
  verifyProjectDomain(input: { hostname: string }): Promise<DomainProviderResult>
  removeProjectDomain(input: { hostname: string }): Promise<void>
}

export function normalizeDomainHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
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
