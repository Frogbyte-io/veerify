import type { FetchImpl } from '~/server/services/support-channels/types'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import {
  SendingDomainProviderError,
  type ForwardDestinationStatus,
  type InboundRouteInput,
  type InboundRouteResult,
  type ProviderDomainResult,
  type ProviderDomainUsageTotals,
  type ProviderForwardDestination,
  type ProviderReceivingState,
  type ReceivingStatus,
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
  frogmail_forward_destinations?: FrogmailForwardDestination[]
}

/** A Frogmail forward destination, as route responses and `/api/v1/forward-destinations` return it. */
interface FrogmailForwardDestination {
  id?: string
  email?: string
  status?: string
  status_reason?: string | null
  verification_sent_at?: string | null
  verified_at?: string | null
}

interface FrogmailReceiving {
  status?: string
  forwarding_paused?: boolean
  records?: Array<{ type?: string; name?: string; priority?: number | string; value?: string; status?: string }>
  last_received_at?: string | null
}

/** Native Frogmail (`/api/v1`) bodies: `{data}` or `{data: [], next_cursor}`. */
interface FrogmailNativeBody {
  data?: unknown
  next_cursor?: string | null
}

/** Frogmail's limit on email forwards per route. */
export const MAX_ROUTE_FORWARDS = 5

const RECEIVING_STATUSES: ReceivingStatus[] = ['disabled', 'pending_verification', 'pending_mx', 'active']
const DESTINATION_STATUSES: ForwardDestinationStatus[] = ['pending', 'verified', 'revoked', 'suspended']

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDestination(raw: FrogmailForwardDestination): ProviderForwardDestination | null {
  if (!raw?.id || !raw.email) return null
  const status = DESTINATION_STATUSES.includes(raw.status as ForwardDestinationStatus)
    ? (raw.status as ForwardDestinationStatus)
    : 'pending'
  return {
    id: String(raw.id),
    email: String(raw.email).toLowerCase(),
    status,
    statusReason: typeof raw.status_reason === 'string' ? raw.status_reason : null,
    verificationSentAt: toDate(raw.verification_sent_at),
    verifiedAt: toDate(raw.verified_at),
  }
}

function toReceiving(domain: string, raw: FrogmailReceiving | undefined): ProviderReceivingState {
  const status = RECEIVING_STATUSES.includes(raw?.status as ReceivingStatus)
    ? (raw!.status as ReceivingStatus)
    : 'disabled'
  return {
    status,
    forwardingPaused: raw?.forwarding_paused === true,
    records: (raw?.records ?? []).map((record) => ({
      purpose: 'receiving' as const,
      type: String(record.type ?? 'MX').toUpperCase() as SendingDomainDnsRecord['type'],
      name: (record.name ?? '').trim() || domain,
      value: String(record.value ?? ''),
      ...(record.priority !== undefined && record.priority !== null ? { priority: String(record.priority) } : {}),
      status:
        record.status === 'valid'
          ? ('valid' as const)
          : record.status === 'invalid'
            ? ('invalid' as const)
            : ('unknown' as const),
    })),
    lastReceivedAt: toDate(raw?.last_received_at),
  }
}

/** A forward destination for a route action: a plain address, no quotes or control characters. */
function routeForwardAddress(email: string): string {
  const value = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!/^[^\s"\\@<>()]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
    throw new SendingDomainProviderError('forward_destination_invalid', 'The forward address is not valid', false)
  }
  return value
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
  capabilities: SendingDomainCapabilities = {
    register: true,
    verifyNow: true,
    remove: true,
    inboundRoutes: true,
    authorizesSubdomains: true,
    forwarding: false,
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
    forwarding?: boolean
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
    // Frogmail with SES receiving only; plain Mailgun has none of the /api/v1 calls.
    const forwarding = options?.forwarding ?? process.env.MAIL_FORWARDING_ENABLED?.trim().toLowerCase() === 'true'
    this.capabilities = { ...this.capabilities, forwarding }
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

  async createInboundRoute(input: InboundRouteInput): Promise<InboundRouteResult> {
    const body = await this.request('POST', '/v3/routes', { form: this.routeForm(input) })
    const routeId = body.route?.id ?? body.id
    if (!routeId) {
      throw new SendingDomainProviderError('unknown', 'The provider did not return a route id', false)
    }
    return { routeId: String(routeId), forwardDestinations: this.routeDestinations(body) }
  }

  async updateInboundRoute(routeId: string, input: InboundRouteInput): Promise<InboundRouteResult> {
    const body = await this.request('PUT', `/v3/routes/${encodeURIComponent(routeId)}`, {
      form: this.routeForm(input),
    })
    return { routeId, forwardDestinations: this.routeDestinations(body) }
  }

  /**
   * Inbox delivery (`forward(url)`) first, then each email forward, then
   * `stop()`. A route needs at least one of the two.
   */
  private routeForm(input: InboundRouteInput): URLSearchParams {
    const route = inboundRouteDefinition(input.address)
    const forwards = [...new Set((input.forwardTo ?? []).map(routeForwardAddress))]
    if (forwards.length > MAX_ROUTE_FORWARDS) {
      throw new SendingDomainProviderError(
        'forward_destination_invalid',
        `An address can forward to at most ${MAX_ROUTE_FORWARDS} mailboxes`,
        false
      )
    }
    if (!input.forwardUrl && forwards.length === 0) {
      throw new SendingDomainProviderError('invalid_domain', 'A route needs inbox delivery or a forward', false)
    }
    const form = new URLSearchParams()
    form.append('priority', String(route.priority))
    form.append('description', input.description)
    form.append('expression', route.expression)
    if (input.forwardUrl) form.append('action', `forward("${input.forwardUrl.replace(/["\\]/g, '')}")`)
    for (const email of forwards) form.append('action', `forward("${email}")`)
    form.append('action', 'stop()')
    return form
  }

  private routeDestinations(body: MailgunResponseBody): ProviderForwardDestination[] {
    const list = Array.isArray(body.frogmail_forward_destinations) ? body.frogmail_forward_destinations : []
    return list.map(toDestination).filter((item): item is ProviderForwardDestination => item !== null)
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

  async enableReceiving(domain: string): Promise<ProviderReceivingState> {
    const name = normalizeDomainName(domain)
    const body = await this.native('PUT', `/api/v1/domains/${encodeURIComponent(name)}/receiving`, { provider: 'ses' })
    return toReceiving(name, body.data as FrogmailReceiving)
  }

  async getReceiving(domain: string): Promise<ProviderReceivingState | null> {
    const name = normalizeDomainName(domain)
    try {
      const body = await this.native('GET', `/api/v1/domains/${encodeURIComponent(name)}/receiving`)
      return toReceiving(name, body.data as FrogmailReceiving)
    } catch (error) {
      if (error instanceof SendingDomainProviderError && error.code === 'not_found') return null
      throw error
    }
  }

  async setForwardingPaused(domain: string, paused: boolean): Promise<ProviderReceivingState> {
    const name = normalizeDomainName(domain)
    const body = await this.native('PATCH', `/api/v1/domains/${encodeURIComponent(name)}/receiving`, {
      forwarding_paused: paused,
    })
    return toReceiving(name, body.data as FrogmailReceiving)
  }

  async disableReceiving(domain: string): Promise<void> {
    const name = normalizeDomainName(domain)
    try {
      await this.native('DELETE', `/api/v1/domains/${encodeURIComponent(name)}/receiving`)
    } catch (error) {
      if (error instanceof SendingDomainProviderError && error.code === 'not_found') return
      throw error
    }
  }

  async listForwardDestinations(domain: string): Promise<ProviderForwardDestination[]> {
    const name = normalizeDomainName(domain)
    const result: ProviderForwardDestination[] = []
    let cursor: string | null = null
    // Bounded: a domain has a handful of destinations; 20 pages is far beyond that.
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ domain: name })
      if (cursor) query.set('cursor', cursor)
      const body = await this.native('GET', `/api/v1/forward-destinations?${query}`)
      const items = Array.isArray(body.data) ? (body.data as FrogmailForwardDestination[]) : []
      for (const item of items) {
        const destination = toDestination(item)
        if (destination) result.push(destination)
      }
      cursor = body.next_cursor ?? null
      if (!cursor) break
    }
    return result
  }

  async createForwardDestination(domain: string, email: string): Promise<ProviderForwardDestination> {
    const body = await this.native('POST', '/api/v1/forward-destinations', {
      domain: normalizeDomainName(domain),
      email: routeForwardAddress(email),
    })
    return this.destinationFrom(body)
  }

  async resendForwardDestination(id: string): Promise<ProviderForwardDestination> {
    const body = await this.native('POST', `/api/v1/forward-destinations/${encodeURIComponent(id)}/resend`)
    return this.destinationFrom(body)
  }

  async deleteForwardDestination(id: string): Promise<ProviderForwardDestination | null> {
    try {
      const body = await this.native('DELETE', `/api/v1/forward-destinations/${encodeURIComponent(id)}`)
      return this.destinationFrom(body)
    } catch (error) {
      if (error instanceof SendingDomainProviderError && error.code === 'not_found') return null
      throw error
    }
  }

  async getDomainUsage(input: { domains: string[]; from: string; to: string }): Promise<ProviderDomainUsageTotals> {
    const totals: ProviderDomainUsageTotals = { received: 0, forwarded: 0, forwardSkipped: 0, blocked: 0 }
    if (input.domains.length === 0) return totals
    const query = new URLSearchParams({ from: input.from, to: input.to, limit: '1' })
    for (const domain of input.domains) query.append('domain[]', normalizeDomainName(domain))
    const body = (await this.native('GET', `/api/v1/domain-usage?${query}`)) as FrogmailNativeBody & {
      totals?: Record<string, unknown>
    }
    const count = (value: unknown) => Number(value ?? 0) || 0
    return {
      received: count(body.totals?.received),
      forwarded: count(body.totals?.forwarded),
      forwardSkipped: count(body.totals?.forward_skipped),
      blocked: count(body.totals?.blocked),
    }
  }

  private destinationFrom(body: FrogmailNativeBody): ProviderForwardDestination {
    const destination = toDestination(body.data as FrogmailForwardDestination)
    if (!destination) {
      throw new SendingDomainProviderError(
        'provider_unavailable',
        'The provider returned an unreadable destination',
        true
      )
    }
    return destination
  }

  /** Native Frogmail API: Bearer auth, JSON bodies, errors as `{message, code}`. */
  private async native(method: string, path: string, json?: Record<string, unknown>): Promise<FrogmailNativeBody> {
    return (await this.request(method, path, { json, bearer: true })) as FrogmailNativeBody
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
    options?: { form?: URLSearchParams; json?: Record<string, unknown>; bearer?: boolean }
  ): Promise<MailgunResponseBody & FrogmailNativeBody> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: options?.bearer
        ? `Bearer ${this.apiKey}`
        : `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
    }
    if (options?.form) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if (options?.json) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers,
        body: options?.json ? JSON.stringify(options.json) : options?.form?.toString(),
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
      return parsed && typeof parsed === 'object' ? (parsed as MailgunResponseBody & FrogmailNativeBody) : {}
    } catch {
      throw new SendingDomainProviderError('provider_unavailable', 'The provider returned an unreadable response', true)
    }
  }

  private toError(response: Response, bodyText: string): SendingDomainProviderError {
    let providerMessage = bodyText
    // Native Frogmail errors carry `code` in the body; Mailgun-compatible ones in X-Frogmail-Error.
    let nativeCode: string | null = null
    try {
      const parsed = JSON.parse(bodyText) as { message?: unknown; code?: unknown }
      if (typeof parsed?.message === 'string') providerMessage = parsed.message
      if (typeof parsed?.code === 'string') nativeCode = parsed.code
    } catch {
      // Plain text body (auth errors).
    }
    const message = sanitizeProviderMessage(providerMessage, [this.apiKey]) || `Provider returned ${response.status}`
    const make = (code: SendingDomainErrorCode, retryable = false, retryAfter?: number) =>
      new SendingDomainProviderError(code, message, retryable, retryAfter)

    // Machine-readable code first (Frogmail F-2 and auth errors).
    const frogmailCode = response.headers.get('X-Frogmail-Error') ?? nativeCode
    switch (frogmailCode) {
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
      case 'not_found':
        return make('not_found')
      case 'receiving_unavailable':
      case 'domain_receives_elsewhere':
      case 'receiving_provider_conflict':
      case 'domain_not_receiving':
      case 'forward_destination_invalid':
      case 'forward_would_loop':
      case 'forward_requires_ses':
      case 'forward_requires_domain':
      case 'conflict':
        return make(frogmailCode as SendingDomainErrorCode)
      case 'verification_throttled':
        return make('verification_throttled', true, parseRetryAfter(response.headers.get('Retry-After')))
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
