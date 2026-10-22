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
  | 'unknown'

export class SendingDomainProviderError extends Error {
  constructor(
    public code: SendingDomainErrorCode,
    message: string,
    public retryable: boolean,
    public retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'SendingDomainProviderError'
  }
}

export interface SendingDomainRegistration extends ProviderDomainResult {
  ownership: 'created' | 'adopted'
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
  createInboundRoute?(input: {
    address: string
    forwardUrl: string
    description: string
  }): Promise<{ routeId: string }>
  deleteInboundRoute?(routeId: string): Promise<void>
}
