import type { FetchImpl } from '~/server/services/support-channels/types'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import {
  SendingDomainProviderError,
  type ProviderDomainResult,
  type SendingDomainCapabilities,
  type SendingDomainErrorCode,
  type SendingDomainProvider,
  type SendingDomainRegistration,
} from '../types'
import { normalizeDomainName, parseRetryAfter, sanitizeProviderMessage } from '../util'

/**
 * Sending-domain management over the Mailgun-compatible API (Mailgun, Frogmail).
 * Design: docs/plans/2026-10-22-custom-sending-domains/design.md §6.2.
 */

const DEFAULT_API_BASE_URL = 'https://api.mailgun.net'
const REQUEST_TIMEOUT_MS = 10_000

/** Shown when Frogmail reports another project as the sending owner of the domain. */
export const CONTESTED_DOMAIN_MESSAGE = 'Another service already sends from this domain.'

interface MailgunDnsRecord {
  name?: string
  record_type?: string
  value?: string
  priority?: string | number | null
  valid?: string
}

interface MailgunResponseBody {
  message?: string
  domain?: { name?: string; state?: string; frogmail_sending_owner?: string }
  receiving_dns_records?: MailgunDnsRecord[]
  sending_dns_records?: MailgunDnsRecord[]
  frogmail_dns_cleanup?: { removed?: string[]; restored?: string[]; kept?: string[]; failed?: string[] }
  route?: { id?: string }
  id?: string
}

/** The address as a Mailgun route pattern, with `.`, `-` and `_` escaped. `+` is refused. */
export function escapeRouteAddress(address: string): string {
  const value = String(address ?? '')
    .trim()
    .toLowerCase()
  if (value.includes('+')) {
    throw new SendingDomainProviderError(
      'invalid_domain',
      'Addresses containing "+" cannot be routed: plus-addressing does not match provider routes',
      false
    )
  }
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(value)) {
    throw new SendingDomainProviderError('invalid_domain', 'The address cannot be used in a provider route', false)
  }
  return escapeRoutePattern(value)
}

/** Escapes the regex metacharacters a validated route pattern can contain (`.`, `-`, `_`). */
function escapeRoutePattern(value: string): string {
  return value.replace(/[.\-_]/g, (char) => `\\${char}`)
}

/** Exact addresses are evaluated first; a catch-all only gets what no exact route took. */
export const EXACT_ROUTE_PRIORITY = 10
export const CATCH_ALL_ROUTE_PRIORITY = 100

const ROUTE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * The route expression and priority for a receiving address (design
 * 2026-10-28-email-addresses, "Frogmail contract"):
 *
 * - `support@acme.com`: `match_recipient("^support@acme\.com$")` at priority 10;
 * - `*@acme.com` (catch-all): `match_recipient("^.*@acme\.com$")` at priority 100,
 *   every address of exactly that domain, not of its subdomains. Frogmail reads
 *   `.*@domain` as the zone's catch-all and strips the anchors; on Mailgun the
 *   anchors keep `x@acme.com.evil.test` from matching.
 *
 * Never `catch_all()`: in Frogmail's shared project it would match every
 * customer's domains. The caller adds `stop()` to both.
 */
export function inboundRouteDefinition(address: string): { expression: string; priority: number } {
  const value = String(address ?? '')
    .trim()
    .toLowerCase()
  if (value.startsWith('*@')) {
    const domain = value.slice(2)
    if (!ROUTE_DOMAIN.test(domain)) {
      throw new SendingDomainProviderError('invalid_domain', 'The domain cannot be used in a provider route', false)
    }
    return { expression: `match_recipient("^.*@${escapeRoutePattern(domain)}$")`, priority: CATCH_ALL_ROUTE_PRIORITY }
  }
  return { expression: `match_recipient("^${escapeRouteAddress(value)}$")`, priority: EXACT_ROUTE_PRIORITY }
}

function mapRecord(
  record: MailgunDnsRecord,
  purpose: 'sending' | 'receiving',
  fallbackName: string
): SendingDomainDnsRecord {
  const type = String(record.record_type ?? '').toUpperCase()
  const mapped: SendingDomainDnsRecord = {
    purpose,
    type: type as SendingDomainDnsRecord['type'],
    // Receiving MX records carry no host: they sit on the zone itself.
    name: (record.name ?? '').trim() || fallbackName,
    value: String(record.value ?? ''),
    status: record.valid === 'valid' ? 'valid' : record.valid === 'invalid' ? 'invalid' : 'unknown',
  }
  if (record.priority !== undefined && record.priority !== null && record.priority !== '') {
    mapped.priority = String(record.priority)
  }
  return mapped
}

export class MailgunSendingDomainProvider implements SendingDomainProvider {
  readonly name = 'mailgun'
  readonly accountKey: string
  readonly capabilities: SendingDomainCapabilities = {
    register: true,
    verifyNow: true,
    remove: true,
    inboundRoutes: true,
    authorizesSubdomains: true,
  }

  private readonly apiKey: string
  private readonly apiBaseUrl: string
  private readonly fetchImpl: FetchImpl
  private readonly timeoutMs: number

  constructor(options?: {
    apiKey?: string
    accountKey?: string
    apiBaseUrl?: string
    fetchImpl?: FetchImpl
    timeoutMs?: number
  }) {
    this.apiKey = (options?.apiKey ?? process.env.SUPPORT_MAILGUN_API_KEY ?? '').trim()
    this.accountKey = (options?.accountKey ?? process.env.SUPPORT_MAILGUN_ACCOUNT_KEY ?? '').trim()
    // `||`, not `??`: .env.example and docker-compose set this to an empty
    // string when unused, which would otherwise yield relative URLs.
    this.apiBaseUrl = (
      options?.apiBaseUrl?.trim() ||
      process.env.SUPPORT_MAILGUN_API_BASE_URL?.trim() ||
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '')
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  }

  isConfigured(): { configured: boolean; missing: string[] } {
    const missing: string[] = []
    if (!this.apiKey) missing.push('SUPPORT_MAILGUN_API_KEY')
    if (!this.accountKey) missing.push('SUPPORT_MAILGUN_ACCOUNT_KEY')
    return { configured: missing.length === 0, missing }
  }

  async register(domain: string): Promise<SendingDomainRegistration> {
    const name = normalizeDomainName(domain)
    try {
      const body = await this.request('POST', '/v4/domains', { form: new URLSearchParams({ name }) })
      return { ...this.toResult(name, body), ownership: 'created' }
    } catch (error) {
      if (!(error instanceof SendingDomainProviderError) || error.code !== 'already_exists') throw error
    }

    // The project already has the domain (an earlier attempt, or an operator
    // added it): adopt it rather than failing the claim.
    const existing = await this.get(name)
    if (!existing) {
      throw new SendingDomainProviderError(
        'already_exists',
        'The provider reports the domain exists but did not return it',
        false
      )
    }
    return { ...existing, ownership: 'adopted' }
  }

  async get(domain: string): Promise<ProviderDomainResult | null> {
    const name = normalizeDomainName(domain)
    try {
      const body = await this.request('GET', `/v4/domains/${encodeURIComponent(name)}`)
      return this.toResult(name, body)
    } catch (error) {
      if (error instanceof SendingDomainProviderError && error.code === 'not_found') return null
      throw error
    }
  }

  async verify(domain: string): Promise<ProviderDomainResult> {
    const name = normalizeDomainName(domain)
    const body = await this.request('PUT', `/v4/domains/${encodeURIComponent(name)}/verify`)
    return this.toResult(name, body)
  }

  async remove(domain: string): Promise<{ cleanup: { removed: string[]; kept: string[]; failed: string[] } | null }> {
    const name = normalizeDomainName(domain)
    const body = await this.request('DELETE', `/v3/domains/${encodeURIComponent(name)}`)
    const report = body.frogmail_dns_cleanup
    if (!report || typeof report !== 'object') return { cleanup: null }
    const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item)) : [])
    return {
      cleanup: {
        // A restored record (merged SPF) was edited by us, so it counts as removed.
        removed: [...list(report.removed), ...list(report.restored)],
        kept: list(report.kept),
        failed: list(report.failed),
      },
    }
  }

  async createInboundRoute(input: {
    address: string
    forwardUrl: string
    description: string
  }): Promise<{ routeId: string }> {
    const route = inboundRouteDefinition(input.address)
    const form = new URLSearchParams()
    form.append('priority', String(route.priority))
    form.append('description', input.description)
    form.append('expression', route.expression)
    form.append('action', `forward("${input.forwardUrl.replace(/["\\]/g, '')}")`)
    form.append('action', 'stop()')

    const body = await this.request('POST', '/v3/routes', { form })
    const routeId = body.route?.id ?? body.id
    if (!routeId) {
      throw new SendingDomainProviderError('unknown', 'The provider did not return a route id', false)
    }
    return { routeId: String(routeId) }
  }

  async deleteInboundRoute(routeId: string): Promise<void> {
    try {
      await this.request('DELETE', `/v3/routes/${encodeURIComponent(routeId)}`)
    } catch (error) {
      // Already gone is the outcome we wanted.
      if (error instanceof SendingDomainProviderError && error.code === 'not_found') return
      throw error
    }
  }

  private toResult(domain: string, body: MailgunResponseBody): ProviderDomainResult {
    const sending = (body.sending_dns_records ?? []).map((record) => mapRecord(record, 'sending', domain))
    const receiving = (body.receiving_dns_records ?? []).map((record) => mapRecord(record, 'receiving', domain))
    // Frogmail reports a contested domain as `unverified` plus this extension; never
    // trust `active` next to it.
    const contested = body.domain?.frogmail_sending_owner === 'other_project'
    const message = contested ? CONTESTED_DOMAIN_MESSAGE : sanitizeProviderMessage(body.message, [this.apiKey])
    return {
      domain: normalizeDomainName(body.domain?.name ?? domain),
      state: body.domain?.state === 'active' && !contested ? 'active' : 'unverified',
      receivesMail: receiving.length > 0,
      records: [...sending, ...receiving],
      message: message || null,
      ...(contested ? { contested: true } : {}),
    }
  }

  private async request(
    method: string,
    path: string,
    options?: { form?: URLSearchParams }
  ): Promise<MailgunResponseBody> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
    }
    if (options?.form) headers['Content-Type'] = 'application/x-www-form-urlencoded'

    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers,
        body: options?.form?.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new SendingDomainProviderError(
        'provider_unavailable',
        timedOut ? 'The provider did not answer in time' : 'The provider could not be reached',
        true
      )
    }

    const text = await response.text().catch(() => '')
    if (!response.ok) throw this.toError(response, text)

    if (!text) return {}
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? (parsed as MailgunResponseBody) : {}
    } catch {
      throw new SendingDomainProviderError('provider_unavailable', 'The provider returned an unreadable response', true)
    }
  }

  private toError(response: Response, bodyText: string): SendingDomainProviderError {
    let providerMessage = bodyText
    try {
      const parsed = JSON.parse(bodyText) as { message?: unknown }
      if (typeof parsed?.message === 'string') providerMessage = parsed.message
    } catch {
      // Plain text body (auth errors).
    }
    const message = sanitizeProviderMessage(providerMessage, [this.apiKey]) || `Provider returned ${response.status}`
    const make = (code: SendingDomainErrorCode, retryable = false, retryAfter?: number) =>
      new SendingDomainProviderError(code, message, retryable, retryAfter)

    // Machine-readable code first (Frogmail F-2 and auth errors).
    switch (response.headers.get('X-Frogmail-Error')) {
      case 'domain_taken':
        return make('already_exists')
      case 'domain_owned_elsewhere':
        return make('owned_elsewhere')
      case 'invalid_domain':
        return make('invalid_domain')
      case 'domain_receives_mail':
        return make('receiving_enabled')
      case 'provider_unavailable':
        return make('provider_unavailable', true)
      case 'missing_scope':
        return make('missing_scope')
      case 'unauthenticated':
        return make('unauthorized')
      default:
        break
    }

    const status = response.status
    if (status === 401 || status === 403) return make('unauthorized')
    if (status === 404) return make('not_found')
    if (status === 429) return make('rate_limited', true, parseRetryAfter(response.headers.get('Retry-After')))
    if (status >= 500) return make('provider_unavailable', true)
    if (status === 400) {
      if (/already taken/i.test(message)) return make('already_exists')
      if (/another project/i.test(message)) return make('owned_elsewhere')
      if (/receives mail/i.test(message)) return make('receiving_enabled')
      return make('invalid_domain')
    }
    return make('unknown')
  }
}
