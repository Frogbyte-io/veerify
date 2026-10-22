import type { FetchImpl } from '~/server/services/support-channels/types'
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
 * Postmark in list-only mode (design §6.3): the operator adds the domain in
 * Postmark by hand, and Veerify only reads the account's domain list to learn
 * whether it is verified. Nothing is created, re-checked or deleted remotely.
 */

const DOMAINS_URL = 'https://api.postmarkapp.com/domains'
const PAGE_SIZE = 500
const MAX_PAGES = 10
const REQUEST_TIMEOUT_MS = 10_000
const OPERATOR_MESSAGE = 'Your Veerify operator adds this domain in Postmark and sends you its DNS records.'

interface PostmarkDomainRow {
  Name?: string
  DKIMVerified?: boolean
  ReturnPathDomainVerified?: boolean
}

export class PostmarkSendingDomainProvider implements SendingDomainProvider {
  readonly name = 'postmark'
  readonly accountKey: string
  readonly capabilities: SendingDomainCapabilities = {
    register: false,
    verifyNow: false,
    remove: false,
    inboundRoutes: false,
    authorizesSubdomains: false,
  }

  private readonly apiToken: string
  private readonly fetchImpl: FetchImpl
  private readonly timeoutMs: number

  constructor(options?: { apiToken?: string; accountKey?: string; fetchImpl?: FetchImpl; timeoutMs?: number }) {
    this.apiToken = (options?.apiToken ?? process.env.SUPPORT_POSTMARK_ACCOUNT_TOKEN ?? '').trim()
    this.accountKey = (options?.accountKey ?? process.env.SUPPORT_POSTMARK_ACCOUNT_KEY ?? '').trim()
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  }

  isConfigured(): { configured: boolean; missing: string[] } {
    const missing: string[] = []
    if (!this.apiToken) missing.push('SUPPORT_POSTMARK_ACCOUNT_TOKEN')
    if (!this.accountKey) missing.push('SUPPORT_POSTMARK_ACCOUNT_KEY')
    return { configured: missing.length === 0, missing }
  }

  /** Nothing is registered remotely, so the claim always counts as adopted: never delete what we did not create. */
  async register(domain: string): Promise<SendingDomainRegistration> {
    return { ...(await this.lookup(domain)), ownership: 'adopted' }
  }

  async get(domain: string): Promise<ProviderDomainResult | null> {
    const name = normalizeDomainName(domain)
    const row = await this.find(name)
    return row ? this.toResult(name, row) : null
  }

  async verify(domain: string): Promise<ProviderDomainResult> {
    return this.lookup(domain)
  }

  async remove(): Promise<{ cleanup: null }> {
    return { cleanup: null }
  }

  private async lookup(domain: string): Promise<ProviderDomainResult> {
    const name = normalizeDomainName(domain)
    return this.toResult(name, await this.find(name))
  }

  private toResult(domain: string, row: PostmarkDomainRow | null): ProviderDomainResult {
    return {
      domain,
      state: row?.DKIMVerified && row.ReturnPathDomainVerified ? 'active' : 'unverified',
      receivesMail: false,
      records: [],
      message: OPERATOR_MESSAGE,
    }
  }

  /** Exact (case-insensitive) match on the account's domain list; a parent domain does not count. */
  private async find(name: string): Promise<PostmarkDomainRow | null> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.list(page * PAGE_SIZE)
      const rows = body.Domains ?? []
      const match = rows.find((row) => normalizeDomainName(row.Name ?? '') === name)
      if (match) return match
      const total = typeof body.TotalCount === 'number' ? body.TotalCount : rows.length
      if (rows.length === 0 || (page + 1) * PAGE_SIZE >= total) break
    }
    return null
  }

  private async list(offset: number): Promise<{ TotalCount?: number; Domains?: PostmarkDomainRow[] }> {
    let response: Response
    try {
      response = await this.fetchImpl(`${DOMAINS_URL}?count=${PAGE_SIZE}&offset=${offset}`, {
        headers: { Accept: 'application/json', 'X-Postmark-Account-Token': this.apiToken },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new SendingDomainProviderError(
        'provider_unavailable',
        timedOut ? 'Postmark did not answer in time' : 'Postmark could not be reached',
        true
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let detail = text
      try {
        const parsed = JSON.parse(text) as { Message?: unknown }
        if (typeof parsed?.Message === 'string') detail = parsed.Message
      } catch {
        // Not JSON.
      }
      const message = sanitizeProviderMessage(detail, [this.apiToken]) || `Postmark returned ${response.status}`
      const status = response.status
      let code: SendingDomainErrorCode = 'unknown'
      let retryable = false
      let retryAfter: number | undefined
      if (status === 401 || status === 403) code = 'unauthorized'
      else if (status === 429) {
        code = 'rate_limited'
        retryable = true
        retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
      } else if (status >= 500) {
        code = 'provider_unavailable'
        retryable = true
      }
      throw new SendingDomainProviderError(code, message, retryable, retryAfter)
    }

    try {
      return (await response.json()) as { TotalCount?: number; Domains?: PostmarkDomainRow[] }
    } catch {
      throw new SendingDomainProviderError('provider_unavailable', 'Postmark returned an unreadable response', true)
    }
  }
}
