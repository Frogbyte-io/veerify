/**
 * Provider contract for customer sending-domain management (design §6.1).
 * Separate from `ChannelDriver`: domain management has its own credentials and lifecycle.
 */
import type { SendingDomainCapabilities, SendingDomainDnsRecord } from '~/lib/support-sending-domains'

export type { SendingDomainCapabilities, SendingDomainDnsRecord }

export interface ProviderDomainResult {
  domain: string
  state: 'active' | 'unverified'
  /** Frogmail: `receiving_dns_records` is non-empty. */
  receivesMail: boolean
  /** Records with purpose `sending` or `receiving`. */
  records: SendingDomainDnsRecord[]
  message: string | null
  /**
   * Another project of the same provider account owns sending for this domain
   * (Frogmail `frogmail_sending_owner: "other_project"`). `state` is `unverified`
   * and `message` explains it; DNS alone cannot fix this.
   */
  contested?: boolean
}

export type SendingDomainErrorCode =
  | 'already_exists'
  | 'owned_elsewhere'
  | 'invalid_domain'
  | 'not_found'
  | 'receiving_enabled'
  | 'rate_limited'
  | 'unauthorized'
  | 'missing_scope'
  | 'provider_unavailable'
  // Frogmail SES receiving and forwarding (Frogmail design §10).
  | 'receiving_unavailable'
  | 'domain_receives_elsewhere'
  | 'receiving_provider_conflict'
  | 'domain_not_receiving'
  | 'forward_destination_invalid'
  | 'forward_would_loop'
  | 'forward_requires_ses'
  | 'forward_requires_domain'
  | 'verification_throttled'
  | 'conflict'
  | 'unknown'

export class SendingDomainProviderError extends Error {
  constructor(
    public code: SendingDomainErrorCode,
    message: string,
    public retryable: boolean,
    public retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'SendingDomainProviderError'
  }
}

export interface SendingDomainRegistration extends ProviderDomainResult {
  ownership: 'created' | 'adopted'
}

/** Frogmail `GET /api/v1/domains/{d}/receiving` `status`. */
export type ReceivingStatus = 'disabled' | 'pending_verification' | 'pending_mx' | 'active'

export interface ProviderReceivingState {
  status: ReceivingStatus
  forwardingPaused: boolean
  /** The SES MX record, purpose `receiving`. */
  records: SendingDomainDnsRecord[]
  lastReceivedAt: Date | null
}

export type ForwardDestinationStatus = 'pending' | 'verified' | 'revoked' | 'suspended'

export interface ProviderForwardDestination {
  id: string
  email: string
  status: ForwardDestinationStatus
  /** unsubscribed, api, bounced, complained, expired, domain_disabled. Null on route responses. */
  statusReason: string | null
  /** Null while the domain is not active yet, or while a rate limit holds the email back. */
  verificationSentAt: Date | null
  verifiedAt: Date | null
}

/** An inbound route: inbox delivery (`forwardUrl`), email forwards, or both. */
export interface InboundRouteInput {
  address: string
  /** Null for a forward-only address. */
  forwardUrl: string | null
  /** External mailboxes, at most `MAX_ROUTE_FORWARDS`. */
  forwardTo?: string[]
  description: string
}

export interface InboundRouteResult {
  routeId: string
  forwardDestinations: ProviderForwardDestination[]
}

/** Frogmail `domain-usage` totals over a range. Counts are per destination (one message to two forwards is 2). */
export interface ProviderDomainUsageTotals {
  received: number
  forwarded: number
  forwardSkipped: number
  blocked: number
}

/** Outcome of `ensureDeliveryWebhooks`, per webhook event. */
export interface DeliveryWebhooksResult {
  /** Created with our URL (the event had none). */
  created: string[]
  /** Our URL added next to the event's existing URLs. */
  updated: string[]
  /** Already pointing at our URL. */
  unchanged: string[]
  /** Not changed: the event already has the provider's maximum of URLs, none of them ours. */
  full: string[]
  /**
   * The provider issued the project's webhook signing key while saving (Frogmail
   * returns it once as `mailgun_signing_key`). The key itself is never returned.
   */
  signingKeyIssued: boolean
}

export interface SendingDomainProvider {
  readonly name: string
  readonly accountKey: string
  readonly capabilities: SendingDomainCapabilities
  /** Missing settings are reported by name only (D-34). */
  isConfigured(): { configured: boolean; missing: string[] }
  /** Registers the domain; adopts it (ownership `adopted`) when the project already has it. */
  register(domain: string): Promise<SendingDomainRegistration>
  /** `null` when the provider does not know the domain. */
  get(domain: string): Promise<ProviderDomainResult | null>
  verify(domain: string): Promise<ProviderDomainResult>
  remove(domain: string): Promise<{
    cleanup: { removed: string[]; kept: string[]; failed: string[] } | null
  }>
  /**
   * Route mail for `address` to `forwardUrl`. `address` is an exact address
   * (matched exactly, evaluated first) or a catch-all `*@domain` (every address
   * of exactly that domain, evaluated after every exact route). See
   * `inboundRouteDefinition` in `providers/mailgun.ts`.
   */
  createInboundRoute?(input: InboundRouteInput): Promise<InboundRouteResult>
  /** Replaces the route's actions (and expression); same input as create. */
  updateInboundRoute?(routeId: string, input: InboundRouteInput): Promise<InboundRouteResult>
  deleteInboundRoute?(routeId: string): Promise<void>

  /**
   * SES receiving and email forwarding (Frogmail only; `capabilities.forwarding`).
   * See docs/plans/2026-10-28-email-addresses/design.md → Frogmail contract.
   */
  enableReceiving?(domain: string): Promise<ProviderReceivingState>
  /** `null` when the provider does not know the domain. */
  getReceiving?(domain: string): Promise<ProviderReceivingState | null>
  setForwardingPaused?(domain: string, paused: boolean): Promise<ProviderReceivingState>
  disableReceiving?(domain: string): Promise<void>
  listForwardDestinations?(domain: string): Promise<ProviderForwardDestination[]>
  createForwardDestination?(domain: string, email: string): Promise<ProviderForwardDestination>
  resendForwardDestination?(id: string): Promise<ProviderForwardDestination>
  deleteForwardDestination?(id: string): Promise<ProviderForwardDestination | null>
  /**
   * Totals over `domains`, `from`/`to` inclusive (UTC dates, at most 92 days apart). One request:
   * Frogmail's `totals` covers the whole range even when `data` paginates. History survives
   * disabling receiving, so a workspace cannot reset its count.
   */
  getDomainUsage?(input: { domains: string[]; from: string; to: string }): Promise<ProviderDomainUsageTotals>
  /**
   * Make each of `events` deliver to `url` (Mailgun `/v3/domains/{d}/webhooks`), keeping
   * any other URLs already set. Idempotent: an event that already has `url` is not touched.
   */
  ensureDeliveryWebhooks?(domain: string, url: string, events: readonly string[]): Promise<DeliveryWebhooksResult>
}
