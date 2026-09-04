import {
  dedupeDnsRecords,
  normalizeDomainHostname,
  type DomainDnsRecord,
  type DomainProvider,
  type DomainProviderResult,
} from '../provider'

interface VercelVerificationEntry {
  type?: string
  domain?: string
  value?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function extractMessage(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null
  return typeof record.message === 'string' ? record.message : null
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry))
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : []
  }

  if (!Array.isArray(value)) {
    return []
  }

  const values: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      values.push(entry.trim())
      continue
    }
    const record = asRecord(entry)
    if (!record) continue
    for (const key of ['value', 'address', 'ip']) {
      const nested = record[key]
      if (typeof nested === 'string' && nested.trim()) {
        values.push(nested.trim())
      }
    }
  }

  return values
}

function mapVerificationRecords(hostname: string, verification: VercelVerificationEntry[]): DomainDnsRecord[] {
  const records: DomainDnsRecord[] = []

  for (const entry of verification) {
    const type = entry.type?.toUpperCase()
    const domain = entry.domain ? normalizeDomainHostname(entry.domain) : hostname
    const value = typeof entry.value === 'string' ? entry.value.trim() : ''
    if (!type || !value || (type !== 'TXT' && type !== 'CNAME' && type !== 'A' && type !== 'AAAA')) {
      continue
    }

    records.push({
      type,
      name: domain,
      value,
    } as DomainDnsRecord)
  }

  return records
}

function isGenericVercelCname(value: string): boolean {
  const normalizedValue = normalizeDomainHostname(value)
  return /^cname\.vercel-dns(?:-\d+)?\.com$/i.test(normalizedValue)
}

function prioritizeDnsRecords(records: DomainDnsRecord[]): DomainDnsRecord[] {
  return [...records].sort((left, right) => {
    if (left.type !== right.type) return 0
    if (left.type !== 'CNAME') return 0

    const sameHost = normalizeDomainHostname(left.name) === normalizeDomainHostname(right.name)
    if (!sameHost) return 0

    const leftIsGeneric = isGenericVercelCname(left.value)
    const rightIsGeneric = isGenericVercelCname(right.value)
    if (leftIsGeneric === rightIsGeneric) return 0
    return leftIsGeneric ? 1 : -1
  })
}

function mapVercelDomainResult(
  hostname: string,
  payloads: { project: unknown; config: unknown }
): DomainProviderResult {
  const projectRecord = asRecord(payloads.project) || {}
  const configRecord = asRecord(payloads.config) || {}
  const configuredBy = typeof configRecord.configuredBy === 'string' ? configRecord.configuredBy : null
  const verified = projectRecord.verified === true
  const verification = asRecordArray(projectRecord.verification).map((entry) => ({
    type: typeof entry.type === 'string' ? entry.type : undefined,
    domain: typeof entry.domain === 'string' ? entry.domain : undefined,
    value: typeof entry.value === 'string' ? entry.value : undefined,
  }))

  const dnsRecords = mapVerificationRecords(hostname, verification)
  const recommendedCnameValues = collectStringValues(configRecord.recommendedCNAME)
  const recommendedIpv4Values = collectStringValues(configRecord.recommendedIPv4)
  const recommendedIpv6Values = collectStringValues(configRecord.recommendedIPv6)

  for (const value of recommendedCnameValues) {
    dnsRecords.push({
      type: 'CNAME',
      name: hostname,
      value,
    })
  }
  for (const value of recommendedIpv4Values) {
    dnsRecords.push({
      type: 'A',
      name: hostname,
      value,
    })
  }
  for (const value of recommendedIpv6Values) {
    dnsRecords.push({
      type: 'AAAA',
      name: hostname,
      value,
    })
  }

  const normalizedRecords = dedupeDnsRecords(prioritizeDnsRecords(dnsRecords))
  const expected = normalizedRecords.length === 1 ? normalizedRecords[0].value : null
  const resolvedTo = collectStringValues(configRecord.misconfigured)
  const status = verified
    ? 'active'
    : verification.length > 0
      ? 'ownership_verification_required'
      : normalizedRecords.length > 0
        ? 'dns_required'
        : 'error'

  return {
    hostname,
    provider: 'vercel',
    verified,
    status,
    dnsRecords: normalizedRecords,
    configuredBy,
    expected,
    resolvedTo,
    message: typeof projectRecord.message === 'string' ? projectRecord.message : null,
  }
}

export class VercelDomainProvider implements DomainProvider {
  private getConfig() {
    const config = useRuntimeConfig()
    const projectId = String(config.vercelProjectId || '').trim()
    const token = String(config.vercelApiToken || '').trim()
    const teamId = String(config.vercelTeamId || '').trim()
    const teamSlug = String(config.vercelTeamSlug || '').trim()

    if (!projectId || !token) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Vercel domain provider is not configured',
      })
    }

    return { projectId, token, teamId, teamSlug }
  }

  private buildQuery() {
    const { teamId, teamSlug } = this.getConfig()
    const params = new URLSearchParams()
    if (teamId) params.set('teamId', teamId)
    if (teamSlug) params.set('slug', teamSlug)
    const query = params.toString()
    return query ? `?${query}` : ''
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token } = this.getConfig()
    const response = await fetch(`https://api.vercel.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      const message = extractMessage(payload?.error) || extractMessage(payload) || 'Vercel API request failed'
      throw createError({
        statusCode: response.status,
        statusMessage: message,
      })
    }

    return payload as T
  }

  private async getMappedDomainResult(hostname: string) {
    const normalizedHostname = normalizeDomainHostname(hostname)
    const { projectId } = this.getConfig()
    const projectPath = `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(normalizedHostname)}${this.buildQuery()}`
    const configPath = `/v6/domains/${encodeURIComponent(normalizedHostname)}/config?projectIdOrName=${encodeURIComponent(projectId)}${this.buildQuery() ? `&${this.buildQuery().slice(1)}` : ''}`

    const [projectPayload, configPayload] = await Promise.all([
      this.request<unknown>(projectPath),
      this.request<unknown>(configPath),
    ])

    return mapVercelDomainResult(normalizedHostname, {
      project: projectPayload,
      config: configPayload,
    })
  }

  async registerProjectDomain(input: { hostname: string }) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { projectId } = this.getConfig()
    try {
      await this.request(`/v10/projects/${encodeURIComponent(projectId)}/domains${this.buildQuery()}`, {
        method: 'POST',
        body: JSON.stringify({ name: hostname }),
      })
    } catch (error: unknown) {
      const err = error as { statusCode?: number; statusMessage?: string; message?: string }
      const message = err.statusMessage || err.message || ''
      const isAlreadyRegistered =
        err.statusCode === 409 ||
        /already (exists|assigned|in use|registered|added)/i.test(message) ||
        /domain.*already/i.test(message)

      if (!isAlreadyRegistered) {
        throw error
      }
    }
    return this.getMappedDomainResult(hostname)
  }

  async getProjectDomainStatus(input: { hostname: string }) {
    return this.getMappedDomainResult(input.hostname)
  }

  async verifyProjectDomain(input: { hostname: string }) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { projectId } = this.getConfig()
    await this.request(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}/verify${this.buildQuery()}`,
      {
        method: 'POST',
      }
    )
    return this.getMappedDomainResult(hostname)
  }

  async removeProjectDomain(input: { hostname: string }) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { projectId } = this.getConfig()
    await this.request(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}${this.buildQuery()}`,
      {
        method: 'DELETE',
      }
    )
  }
}

export { mapVercelDomainResult }
