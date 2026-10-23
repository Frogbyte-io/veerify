import {
  dedupeDnsRecords,
  normalizeDomainHostname,
  type DomainConnectionStatus,
  type DomainDnsRecord,
  type DomainProvider,
  type DomainProviderInput,
  type DomainProviderResult,
} from '../provider'

const PROVIDER_NAME = 'cloudflare-saas'
const API_BASE = 'https://api.cloudflare.com/client/v4'

type FetchLike = typeof fetch

export interface CloudflareSaasOptions {
  fetch?: FetchLike
  apiToken?: string
  zoneId?: string
  cnameTarget?: string
}

export interface CloudflareCustomHostname {
  id?: string
  hostname?: string
  status?: string
  verification_errors?: string[]
  ownership_verification?: { name?: string; type?: string; value?: string }
  ownership_verification_http?: { http_body?: string; http_url?: string }
  ssl?: {
    status?: string
    method?: string
    validation_records?: Array<{
      status?: string
      txt_name?: string
      txt_value?: string
      cname?: string
      cname_target?: string
    }>
    validation_errors?: Array<{ message?: string }>
  }
}

interface CloudflareEnvelope<T> {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  result?: T
}

class CloudflareApiError extends Error {
  status: number
  codes: number[]

  constructor(status: number, codes: number[], message: string) {
    super(message)
    this.status = status
    this.codes = codes
  }
}

const SSL_TIMED_OUT = new Set([
  'initializing_timed_out',
  'validation_timed_out',
  'issuance_timed_out',
  'deployment_timed_out',
  'deletion_timed_out',
])
const HOSTNAME_ERROR = new Set(['blocked', 'pending_blocked', 'test_blocked', 'test_failed'])
const HOSTNAME_GONE = new Set(['deleted', 'pending_deletion'])
const SSL_GONE = new Set(['deleted', 'pending_deletion', 'pending_cleanup', 'deactivating', 'inactive', 'expired'])

function cleanList(values: Array<string | undefined | null>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
}

function collectErrors(record: CloudflareCustomHostname): string[] {
  const verification = Array.isArray(record.verification_errors) ? record.verification_errors : []
  const validation = Array.isArray(record.ssl?.validation_errors)
    ? record.ssl.validation_errors.map((entry) => entry?.message)
    : []
  return cleanList([...verification, ...validation])
}

function buildDnsRecords(hostname: string, cnameTarget: string, record: CloudflareCustomHostname, active: boolean) {
  const records: DomainDnsRecord[] = [{ type: 'CNAME', name: hostname, value: cnameTarget }]
  if (active) return dedupeDnsRecords(records)

  const ownership = record.ownership_verification
  if (ownership?.name && ownership.value) {
    records.push({ type: 'TXT', name: ownership.name, value: ownership.value })
  }
  for (const entry of record.ssl?.validation_records || []) {
    if (entry?.txt_name && entry.txt_value) {
      records.push({ type: 'TXT', name: entry.txt_name, value: entry.txt_value })
    }
  }
  return dedupeDnsRecords(records)
}

/**
 * Map a Cloudflare custom hostname onto a provider-neutral result.
 * `active` only when both the hostname and its certificate are active.
 */
export function mapCloudflareHostname(
  hostnameInput: string,
  record: CloudflareCustomHostname,
  cnameTarget: string
): DomainProviderResult {
  const hostname = normalizeDomainHostname(hostnameInput)
  const hostStatus = String(record.status || '').toLowerCase()
  const sslStatus = String(record.ssl?.status || '').toLowerCase()
  const errors = collectErrors(record)
  const errorText = errors.join('; ')

  let status: DomainConnectionStatus
  let message: string | null = null

  // `active_redeploying` is a live hostname whose config is being re-pushed to the edge.
  // Treating it as inactive would take a working board offline (the app only serves
  // custom domains whose stored status is `active`) until the next check.
  if ((hostStatus === 'active' || hostStatus === 'active_redeploying') && sslStatus === 'active') {
    status = 'active'
  } else if (HOSTNAME_ERROR.has(hostStatus)) {
    status = 'error'
    message = errorText || `Cloudflare blocked this hostname (${hostStatus})`
  } else if (HOSTNAME_GONE.has(hostStatus)) {
    status = 'error'
    message = `This hostname is being removed from Cloudflare (${hostStatus})`
  } else if (SSL_TIMED_OUT.has(sslStatus)) {
    status = 'error'
    message = errorText || `Certificate issuance timed out (${sslStatus}). Check the CNAME and verify again`
  } else if (hostStatus === 'active' && SSL_GONE.has(sslStatus)) {
    status = 'error'
    message = errorText || `Certificate is not usable (${sslStatus})`
  } else if (hostStatus === 'moved') {
    status = 'dns_required'
    message = errorText || 'The CNAME no longer points at the Veerify target'
  } else if (hostStatus === 'active') {
    // Hostname validated, certificate still being validated, issued or deployed.
    const needsTxt = sslStatus === 'pending_validation' && errors.length > 0
    status = needsTxt ? 'ownership_verification_required' : 'dns_required'
    message = errorText || `Certificate is being issued (${sslStatus || 'pending'})`
  } else {
    // pending, pending_migration, pending_provisioned, provisioned, test_*, active_redeploying, unknown.
    const mentionsCname = errors.some((e) => /cname/i.test(e))
    status = errors.length > 0 && !mentionsCname ? 'ownership_verification_required' : 'dns_required'
    message = errorText || (hostStatus ? `Waiting for Cloudflare (${hostStatus})` : null)
  }

  const verified = status === 'active'
  return {
    hostname,
    provider: PROVIDER_NAME,
    verified,
    status,
    dnsRecords: buildDnsRecords(hostname, cnameTarget, record, verified),
    configuredBy: 'CNAME',
    expected: cnameTarget,
    resolvedTo: [],
    message,
    providerDomainId: typeof record.id === 'string' && record.id ? record.id : null,
  }
}

function isDuplicate(error: CloudflareApiError): boolean {
  return error.status === 409 || error.codes.includes(1406) || /duplicate|already exists/i.test(error.message)
}

export class CloudflareSaasDomainProvider implements DomainProvider {
  private readonly options: CloudflareSaasOptions

  constructor(options: CloudflareSaasOptions = {}) {
    this.options = options
  }

  private getConfig() {
    let apiToken = this.options.apiToken
    let zoneId = this.options.zoneId
    let cnameTarget = this.options.cnameTarget
    if (apiToken === undefined || zoneId === undefined || cnameTarget === undefined) {
      const config = useRuntimeConfig()
      apiToken ??= String(config.cloudflareApiToken || '')
      zoneId ??= String(config.cloudflareZoneId || '')
      cnameTarget ??= String(config.public?.cnameTarget || 'cname.veerify.io')
    }
    apiToken = apiToken.trim()
    zoneId = zoneId.trim()
    if (!apiToken || !zoneId) {
      throw createError({ statusCode: 500, statusMessage: 'Cloudflare domain provider is not configured' })
    }
    return { apiToken, zoneId, cnameTarget: normalizeDomainHostname(cnameTarget) }
  }

  /** Raw call. Throws CloudflareApiError for non-2xx; never includes the token. */
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const { apiToken, zoneId } = this.getConfig()
    const doFetch = this.options.fetch || fetch
    let response: Response
    try {
      response = await doFetch(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/custom_hostnames${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      })
    } catch {
      throw createError({ statusCode: 502, statusMessage: 'Could not reach the Cloudflare API' })
    }

    const payload = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null
    if (!response.ok || payload?.success === false) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : []
      throw new CloudflareApiError(
        response.status,
        errors.map((e) => Number(e.code)).filter(Number.isFinite),
        cleanList(errors.map((e) => e.message)).join('; ') || 'Cloudflare API request failed'
      )
    }
    return payload?.result as T
  }

  /** Same as call(), but converts API failures into user-facing createErrors. */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      return await this.call<T>(path, init)
    } catch (error) {
      if (!(error instanceof CloudflareApiError)) throw error
      throw this.toHttpError(error)
    }
  }

  private toHttpError(error: CloudflareApiError) {
    if (error.status === 401 || error.status === 403) {
      return createError({
        statusCode: 502,
        statusMessage:
          'Cloudflare rejected the API token. It must be valid and have Zone > SSL and Certificates: Edit on the Veerify zone',
      })
    }
    if (error.status === 429) {
      return createError({
        statusCode: 429,
        statusMessage: 'Cloudflare is rate limiting domain changes. Try again in a minute',
      })
    }
    if (error.status >= 500) {
      return createError({ statusCode: 502, statusMessage: 'Cloudflare is temporarily unavailable. Try again shortly' })
    }
    return createError({ statusCode: 502, statusMessage: `Cloudflare rejected the request: ${error.message}` })
  }

  private async findByHostname(hostname: string): Promise<CloudflareCustomHostname | null> {
    const results = await this.request<CloudflareCustomHostname[]>(
      `?hostname=${encodeURIComponent(hostname)}&per_page=50`
    )
    const match = (Array.isArray(results) ? results : []).find(
      (entry) => entry?.hostname && normalizeDomainHostname(entry.hostname) === hostname
    )
    return match || null
  }

  /** Look up by stored id, falling back to the hostname (also covers stale ids). */
  private async find(hostname: string, providerDomainId?: string | null) {
    if (providerDomainId) {
      try {
        const record = await this.call<CloudflareCustomHostname>(`/${encodeURIComponent(providerDomainId)}`)
        if (record) return record
      } catch (error) {
        if (!(error instanceof CloudflareApiError)) throw error
        if (error.status !== 404) throw this.toHttpError(error)
      }
    }
    return this.findByHostname(hostname)
  }

  private async register(hostname: string): Promise<CloudflareCustomHostname> {
    try {
      return await this.call<CloudflareCustomHostname>('', {
        method: 'POST',
        body: JSON.stringify({
          hostname,
          ssl: {
            method: 'http',
            type: 'dv',
            bundle_method: 'ubiquitous',
            wildcard: false,
            settings: { min_tls_version: '1.2', tls_1_3: 'on', http2: 'on' },
          },
        }),
      })
    } catch (error) {
      if (!(error instanceof CloudflareApiError)) throw error
      if (!isDuplicate(error)) throw this.toHttpError(error)
      const existing = await this.findByHostname(hostname)
      if (!existing) {
        throw createError({
          statusCode: 409,
          statusMessage: 'This hostname already exists in Cloudflare but could not be looked up',
        })
      }
      return existing
    }
  }

  async registerProjectDomain(input: DomainProviderInput) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { cnameTarget } = this.getConfig()
    return mapCloudflareHostname(hostname, await this.register(hostname), cnameTarget)
  }

  async getProjectDomainStatus(input: DomainProviderInput) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { cnameTarget } = this.getConfig()
    // A row that predates this provider (e.g. static-cname) has no Cloudflare
    // record id: adopt the existing hostname, or register it if it is missing.
    const record = (await this.find(hostname, input.providerDomainId)) || (await this.register(hostname))
    return mapCloudflareHostname(hostname, record, cnameTarget)
  }

  async verifyProjectDomain(input: DomainProviderInput) {
    const hostname = normalizeDomainHostname(input.hostname)
    const { cnameTarget } = this.getConfig()
    const record = (await this.find(hostname, input.providerDomainId)) || (await this.register(hostname))
    const current = mapCloudflareHostname(hostname, record, cnameTarget)

    if (!current.verified && record.id) {
      // PATCH re-triggers validation now that the customer's CNAME may be in place.
      const patched = await this.request<CloudflareCustomHostname>(`/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ssl: { method: 'http', type: 'dv' } }),
      })
      return mapCloudflareHostname(hostname, patched, cnameTarget)
    }
    return current
  }

  /** Read-only lookup: never registers. Used by the sync script's dry run. */
  async lookupProjectDomain(input: DomainProviderInput): Promise<DomainProviderResult | null> {
    const hostname = normalizeDomainHostname(input.hostname)
    const { cnameTarget } = this.getConfig()
    const record = await this.find(hostname, input.providerDomainId)
    return record ? mapCloudflareHostname(hostname, record, cnameTarget) : null
  }

  /** Every custom hostname in the zone (paged). */
  async listCustomHostnames(): Promise<Array<{ id: string; hostname: string; status: string; sslStatus: string }>> {
    const perPage = 100
    const all: Array<{ id: string; hostname: string; status: string; sslStatus: string }> = []
    for (let page = 1; page <= 500; page++) {
      const results = await this.request<CloudflareCustomHostname[]>(`?per_page=${perPage}&page=${page}`)
      const rows = Array.isArray(results) ? results : []
      for (const entry of rows) {
        if (!entry?.hostname || !entry.id) continue
        all.push({
          id: entry.id,
          hostname: normalizeDomainHostname(entry.hostname),
          status: String(entry.status || ''),
          sslStatus: String(entry.ssl?.status || ''),
        })
      }
      if (rows.length < perPage) break
    }
    return all
  }

  async removeProjectDomain(input: DomainProviderInput) {
    const hostname = normalizeDomainHostname(input.hostname)
    const record = await this.find(hostname, input.providerDomainId)
    if (!record?.id) return
    try {
      await this.call(`/${encodeURIComponent(record.id)}`, { method: 'DELETE' })
    } catch (error) {
      if (!(error instanceof CloudflareApiError)) throw error
      if (error.status === 404) return
      throw this.toHttpError(error)
    }
  }
}
