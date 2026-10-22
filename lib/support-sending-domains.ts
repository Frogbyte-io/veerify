/**
 * Shared types and constants for customer sending domains, used by both server
 * and client code. Design: docs/plans/2026-10-22-custom-sending-domains/design.md.
 */

export const SUPPORT_SENDING_DOMAIN_STATUSES = [
  'provisioning',
  'pending',
  'verified',
  'suspended',
  'failed',
  'deleting',
] as const
export type SupportSendingDomainStatus = (typeof SUPPORT_SENDING_DOMAIN_STATUSES)[number]

export type SendingDomainProviderOwnership = 'created' | 'adopted'

export interface SendingDomainDnsRecord {
  purpose: 'ownership' | 'sending' | 'receiving' | 'recommended'
  type: 'TXT' | 'CNAME' | 'MX'
  /** Fully qualified host name. */
  name: string
  value: string
  priority?: string
  status: 'valid' | 'invalid' | 'unknown'
}

export type SenderPolicy = 'legacy' | 'team'

/** One claim as returned by the sending-domain API (design §7.2). */
export interface SendingDomainView {
  id: string
  domain: string
  status: SupportSendingDomainStatus
  providerState: 'active' | 'unverified' | null
  ownershipVerified: boolean
  receivesViaProvider: boolean
  records: SendingDomainDnsRecord[]
  lastCheckedAt: string | null
  nextCheckAt: string | null
  expiresAt: string | null
  verifiedAt: string | null
  lastErrorCode: string | null
  lastError: string | null
  providerOwnership: SendingDomainProviderOwnership | null
  providerMismatch: boolean
}

export interface SendingDomainCapabilities {
  register: boolean
  verifyNow: boolean
  remove: boolean
  inboundRoutes: boolean
  authorizesSubdomains: boolean
}

/** `GET /api/support/teams/[teamId]/sending-domains` response data (design §7.1). */
export interface SendingDomainListResponse {
  enabled: boolean
  policy: SenderPolicy
  provider: string | null
  capabilities: SendingDomainCapabilities | null
  canManage: boolean
  limits: { maxDomains: number; maxPending: number; pendingTtlDays: number }
  providerConfigured: boolean
  missingEnvVars: string[]
  domains: SendingDomainView[]
}

/** `GET /api/support/inboxes/[id]/sending-status` authorization verdict (design §7.3). */
export type TeamSenderVerdict =
  | { status: 'authorized'; domain: { id: string; domain: string } | null; platform?: true }
  | { status: 'pending'; domain: { id: string; domain: string; status: SupportSendingDomainStatus } }
  | {
      status: 'unauthorized'
      reason: 'not_owned' | 'suspended' | 'provider_mismatch'
      teamDomains: string[]
    }
  | { status: 'unknown'; reason: string }

export interface SendingStatusResponse {
  address: string | null
  policy: SenderPolicy
  authorization: TeamSenderVerdict
}

export const MAX_DOMAINS_PER_TEAM = 10
export const MAX_PENDING_PER_TEAM = 3
export const PENDING_TTL_DAYS = 7
/** DNS label that carries the per-claim ownership TXT record. */
export const OWNERSHIP_RECORD_LABEL = '_veerify-mail'
export const OWNERSHIP_RECORD_PREFIX = 'veerify-mail-verification='
