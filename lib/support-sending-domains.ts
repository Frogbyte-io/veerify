/**
 * Shared types and constants for customer sending domains, used by both server
 * and client code. Design: docs/plans/2026-10-22-custom-sending-domains/design.md.
 */

import { parse as parseDomain } from 'tldts'
import type { MailUsage } from './mail-plans'

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

export type SenderPolicy = 'legacy' | 'project'

/** One claim as returned by the sending-domain API (design §7.2). */
export interface SendingDomainView {
  id: string
  domain: string
  /** The registrable domain (eTLD+1) the claim sits under, e.g. `acme.com` for `mail.acme.com`. */
  registrableDomain: string
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
  /** Why a `suspended` claim is suspended; null for every other status. See `sendingDomainSuspendedReason`. */
  suspendedReason: SendingDomainSuspendedReason | null
  providerOwnership: SendingDomainProviderOwnership | null
  providerMismatch: boolean
  /**
   * Frogmail SES receiving status: null until receiving is enabled, then
   * `pending_verification` / `pending_mx` / `active` / `disabled`. Optional for older clients.
   */
  receivingStatus?: 'pending_verification' | 'pending_mx' | 'active' | 'disabled' | null
  /** When the domain last received a message (Frogmail `last_received_at`), or null. */
  lastReceivedAt?: string | null
  /**
   * MX hosts the domain already has, other than the SES inbound host. Publishing the
   * receiving MX moves all of the domain's mail away from them. Null: not looked up.
   */
  existingMxHosts?: string[] | null
  existingMxCheckedAt?: string | null
}

/**
 * Why a claim is suspended, for the UI to pick its copy:
 *
 * - `sender_rejected`: the mail provider refused to send from the domain
 *   although it was verified (`lastErrorCode: 'sender_rejected'`, set by the
 *   outbox; the provider's text is in `lastError`). Usually the provider's own
 *   verification lapsed: re-verify the domain with the provider.
 * - `dns_missing`: the DNS records stopped verifying (`ownership_missing`,
 *   `provider_unverified`). Publish the records again.
 * - `other`: anything else.
 */
export type SendingDomainSuspendedReason = 'sender_rejected' | 'dns_missing' | 'other'

const DNS_SUSPENSION_CODES = new Set(['ownership_missing', 'provider_unverified'])

export function sendingDomainSuspendedReason(
  status: string,
  lastErrorCode: string | null
): SendingDomainSuspendedReason | null {
  if (status !== 'suspended') return null
  if (lastErrorCode === 'sender_rejected') return 'sender_rejected'
  if (lastErrorCode && DNS_SUSPENSION_CODES.has(lastErrorCode)) return 'dns_missing'
  return 'other'
}

export interface SendingDomainCapabilities {
  register: boolean
  verifyNow: boolean
  remove: boolean
  inboundRoutes: boolean
  authorizesSubdomains: boolean
  /**
   * SES receiving and email forwarding (Frogmail, with `MAIL_FORWARDING_ENABLED`).
   * Optional: providers without it never forward.
   */
  forwarding?: boolean
}

/** `GET /api/support/projects/[projectId]/sending-domains` response data (design §7.1). */
export interface SendingDomainListResponse {
  enabled: boolean
  policy: SenderPolicy
  provider: string | null
  capabilities: SendingDomainCapabilities | null
  canManage: boolean
  /**
   * `maxDomains` / `maxPending` are the workspace mail limits (shared by every
   * project of the workspace, see `lib/mail-plans.ts`), not per-project caps.
   */
  limits: { maxDomains: number; maxPending: number; pendingTtlDays: number }
  /** The workspace's mail tier, limits and current usage. */
  usage: MailUsage
  providerConfigured: boolean
  missingEnvVars: string[]
  domains: SendingDomainView[]
}

/** `GET /api/support/inboxes/[id]/sending-status` authorization verdict (design §7.3). */
export type ProjectSenderVerdict =
  | { status: 'authorized'; domain: { id: string; domain: string } | null; platform?: true }
  | { status: 'pending'; domain: { id: string; domain: string; status: SupportSendingDomainStatus } }
  | {
      status: 'unauthorized'
      reason: 'not_owned' | 'suspended' | 'provider_mismatch'
      projectDomains: string[]
      /** Why the matching claim is suspended; set only with `reason: 'suspended'`. */
      suspendedReason?: SendingDomainSuspendedReason
    }
  | { status: 'unknown'; reason: string }

export interface SendingStatusResponse {
  address: string | null
  policy: SenderPolicy
  authorization: ProjectSenderVerdict
}

export const PENDING_TTL_DAYS = 7
/** A suspended claim that nobody repairs is released after this long (design §5.3). */
export const SUSPENDED_TTL_DAYS = 30
/** DNS label that carries the per-claim ownership TXT record. */
export const OWNERSHIP_RECORD_LABEL = '_veerify-mail'
export const OWNERSHIP_RECORD_PREFIX = 'veerify-mail-verification='

// ---------------------------------------------------------------------------
// Pure rules (design §4.2, §5.3, §7.4). No Node-only imports: this file is
// bundled into the browser as well.
// ---------------------------------------------------------------------------

export interface SendingDomainEnvIssue {
  level: 'warn' | 'error' | 'info'
  message: string
}

/**
 * True when the in-memory fake sending-domain provider may run. It is refused
 * in production builds, except when the app's own URL (`BETTER_AUTH_URL`) is
 * a loopback host: that is the e2e suite running a production build locally or
 * in CI. A real deployment never serves its auth origin from localhost.
 */
export function isFakeSendingDomainProviderAllowed(env: Record<string, string | undefined>): boolean {
  if ((env.SUPPORT_SENDING_DOMAIN_PROVIDER ?? '').trim().toLowerCase() !== 'fake') return false
  if ((env.NODE_ENV ?? '').trim() !== 'production') return true
  try {
    const host = new URL((env.BETTER_AUTH_URL ?? '').trim()).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * Misconfiguration checks for the sending-domain env (design §11.1). Pure so it
 * can be unit tested; `server/plugins/validate-env.ts` logs the result. Only
 * names are reported, never values (D-34).
 */
export function sendingDomainEnvIssues(env: Record<string, string | undefined>): SendingDomainEnvIssue[] {
  const get = (name: string) => (env[name] ?? '').trim()
  const issues: SendingDomainEnvIssue[] = []
  const enabled = get('SUPPORT_SENDING_DOMAINS_ENABLED').toLowerCase() === 'true'
  const fake = get('SUPPORT_SENDING_DOMAIN_PROVIDER').toLowerCase() === 'fake'
  const policy = get('SUPPORT_SENDER_POLICY').toLowerCase()

  if (fake && !isFakeSendingDomainProviderAllowed(env)) {
    issues.push({
      level: 'error',
      message: 'SUPPORT_SENDING_DOMAIN_PROVIDER=fake is refused in production and will be ignored.',
    })
  }
  if (policy && policy !== 'legacy' && policy !== 'project' && policy !== 'team') {
    issues.push({
      level: 'warn',
      message: 'SUPPORT_SENDER_POLICY must be "legacy" or "project"; the value is ignored.',
    })
  }
  if (!enabled) return issues

  if (policy === 'legacy') {
    issues.push({
      level: 'error',
      message:
        'SUPPORT_SENDER_POLICY=legacy is set together with SUPPORT_SENDING_DOMAINS_ENABLED=true. Self-serve domains are unsafe without project scope, so the "project" policy applies.',
    })
  }

  const provider = (get('SUPPORT_CHANNEL_PROVIDER') || 'postmark').toLowerCase()
  if (isFakeSendingDomainProviderAllowed(env)) return issues

  if (provider === 'mailgun') {
    const missing = ['SUPPORT_MAILGUN_API_KEY'].filter((name) => !get(name))
    if (missing.length) {
      issues.push({
        level: 'warn',
        message: `SUPPORT_SENDING_DOMAINS_ENABLED=true but the Mailgun/Frogmail provider is not configured. Missing: ${missing.join(', ')}.`,
      })
    }
  } else if (provider === 'postmark') {
    if (!get('SUPPORT_POSTMARK_ACCOUNT_TOKEN')) {
      issues.push({
        level: 'warn',
        message:
          'SUPPORT_SENDING_DOMAINS_ENABLED=true but the Postmark provider is not configured. Missing: SUPPORT_POSTMARK_ACCOUNT_TOKEN.',
      })
    }
    issues.push({
      level: 'info',
      message:
        'Postmark runs sending domains in list-only mode: projects can claim and prove a domain, but an operator adds it in Postmark.',
    })
  } else {
    issues.push({
      level: 'warn',
      message: `SUPPORT_SENDING_DOMAINS_ENABLED=true but provider "${provider}" cannot register sending domains.`,
    })
  }

  return issues
}

/** Consecutive provider `unverified` answers that suspend a verified claim. */
export const SUSPEND_AFTER_PROVIDER_MISSES = 2
/** Consecutive missing ownership TXT lookups that suspend a verified claim. */
export const SUSPEND_AFTER_OWNERSHIP_MISSES = 3

/**
 * Mailbox providers nobody may claim as a sending domain. `gmx.*` is handled by
 * `isMailboxProviderDomain` because GMX runs on many country suffixes.
 */
export const MAILBOX_PROVIDER_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]

const MAX_DOMAIN_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Trim, lowercase, drop one trailing dot, convert IDN to ASCII. Never throws:
 * input that cannot be converted is returned lowercased so `validateSendingDomain`
 * reports it.
 */
export function normalizeSendingDomain(input: string): string {
  const value = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  // Only non-ASCII input needs IDNA conversion. Skipping the URL parser for
  // plain ASCII keeps "acme.com/path" from being silently reduced to "acme.com".
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value
  try {
    const host = new URL(`http://${value}`).hostname
    return host.includes('/') || host.includes('@') || host.includes(':') ? value : host.replace(/\.$/, '')
  } catch {
    return value
  }
}

/** Is `candidate` equal to, or a label-boundary descendant of, `ancestor`? */
export function isSameOrSubdomain(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.endsWith(`.${ancestor}`)
}

/**
 * Registrable domain (eTLD+1) of an already-normalized name, or null when the
 * name has no ICANN public suffix. `.test` is treated as a two-label zone when
 * `allowTestTld` is set (fake provider / e2e only).
 */
export function getRegistrableDomain(domain: string, allowTestTld = false): string | null {
  if (allowTestTld && domain.endsWith('.test')) {
    const labels = domain.split('.')
    return labels.length >= 2 ? labels.slice(-2).join('.') : null
  }
  const parsed = parseDomain(domain, { allowPrivateDomains: false })
  if (parsed.isIp || !parsed.isIcann || !parsed.domain) return null
  return parsed.domain
}

export function isMailboxProviderDomain(domain: string): boolean {
  for (const listed of MAILBOX_PROVIDER_DOMAINS) {
    if (isSameOrSubdomain(domain, listed)) return true
  }
  const registrable = getRegistrableDomain(domain)
  return registrable !== null && /^gmx\.[a-z.]+$/.test(registrable)
}

/**
 * Validate an already-normalized domain. Returns a user-facing message, or null
 * when the domain may be claimed.
 */
export function validateSendingDomain(
  domain: string,
  opts: { reserved: string[]; allowTestTld: boolean }
): string | null {
  if (!domain) return 'Enter a domain name.'
  if (domain.length > MAX_DOMAIN_LENGTH) return 'This domain name is too long.'
  if (/^[0-9.]+$/.test(domain) || domain.includes(':') || domain.startsWith('[')) {
    return 'Enter a domain name, not an IP address.'
  }

  for (const label of domain.split('.')) {
    if (!label || label.length > MAX_LABEL_LENGTH || !LABEL_PATTERN.test(label)) {
      return 'This is not a valid domain name. Use letters, digits and hyphens, for example acme.com.'
    }
  }

  if (!getRegistrableDomain(domain, opts.allowTestTld)) {
    return 'Enter a domain under a public suffix, for example acme.com.'
  }

  if (isMailboxProviderDomain(domain)) {
    return 'Mailbox provider domains cannot be used as a sending domain.'
  }

  for (const entry of opts.reserved) {
    const reserved = normalizeSendingDomain(entry)
    if (!reserved) continue
    if (isSameOrSubdomain(domain, reserved) || isSameOrSubdomain(reserved, domain)) {
      return 'This domain is reserved for the platform and cannot be claimed.'
    }
  }

  return null
}

/**
 * The first claim of another project that equals, sits under, or sits over
 * `domain` (matched on label boundaries, so `badacme.com` never conflicts with
 * `acme.com`). Nesting within the same project is allowed.
 */
export function findHierarchyConflict(
  domain: string,
  projectId: string,
  claims: { domain: string; projectId: string }[]
): { domain: string } | null {
  for (const claim of claims) {
    if (claim.projectId === projectId) continue
    if (isSameOrSubdomain(domain, claim.domain) || isSameOrSubdomain(claim.domain, domain)) {
      return { domain: claim.domain }
    }
  }
  return null
}

/** Host as DNS UIs that append the zone want it: "_veerify-mail", or "@" for the apex. */
export function relativeRecordHost(fqdn: string, zone: string): string {
  const host = String(fqdn).trim().toLowerCase().replace(/\.$/, '')
  const apex = String(zone).trim().toLowerCase().replace(/\.$/, '')
  if (host === apex) return '@'
  if (host.endsWith(`.${apex}`)) return host.slice(0, -(apex.length + 1))
  return host
}

export type OwnershipCheckResult = 'valid' | 'invalid' | 'unknown'

/** The slice of a `project_mail_domain` row `applyProviderResult` reads. */
export interface SendingDomainTransitionRow {
  status: string
  createdAt?: Date | null
  ownershipFailures: number
  providerFailures: number
  ownershipVerifiedAt: Date | null
  verifiedAt: Date | null
  expiresAt: Date | null
  dnsRecords: SendingDomainDnsRecord[]
}

/** The slice of a provider answer `applyProviderResult` reads. */
export interface SendingDomainProviderResultInput {
  state: 'active' | 'unverified'
  receivesMail: boolean
  records: SendingDomainDnsRecord[]
  message?: string | null
}

/** Columns `applyProviderResult` may change (spread into a drizzle `.set()`). */
export interface SendingDomainTransition {
  status: SupportSendingDomainStatus
  providerState: 'active' | 'unverified'
  receivesViaProvider: boolean
  dnsRecords: SendingDomainDnsRecord[]
  ownershipFailures: number
  providerFailures: number
  ownershipVerifiedAt: Date | null
  verifiedAt: Date | null
  expiresAt: Date | null
  lastCheckedAt: Date
  nextCheckAt: Date | null
  lastErrorCode: string | null
  lastError: string | null
  updatedAt: Date
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const DAY = 24 * HOUR

/**
 * When the current pending period began. A pending claim's expiry is always
 * `periodStart + PENDING_TTL_DAYS` (a re-registration restarts it), so the start
 * is derived from `expiresAt` and falls back to `createdAt`. This keeps the
 * re-check cadence tied to the current period without a schema column.
 */
export function pendingPeriodStart(row: { createdAt?: Date | null; expiresAt?: Date | null }): Date | null | undefined {
  if (row.expiresAt) return new Date(row.expiresAt.getTime() - PENDING_TTL_DAYS * DAY)
  return row.createdAt
}

/** Next poll for a claim that is being checked (design §8.2). */
export function nextSendingDomainCheckAt(
  status: SupportSendingDomainStatus,
  createdAt: Date | null | undefined,
  now: Date
): Date | null {
  if (status === 'verified' || status === 'suspended') return new Date(now.getTime() + 24 * HOUR)
  if (status !== 'pending') return null
  const ageMs = createdAt ? now.getTime() - createdAt.getTime() : 0
  const delay = ageMs < HOUR ? 5 * MINUTE : ageMs < 24 * HOUR ? 15 * MINUTE : HOUR
  return new Date(now.getTime() + delay)
}

const RECORD_ORDER: Record<SendingDomainDnsRecord['purpose'], number> = {
  ownership: 0,
  sending: 1,
  receiving: 2,
  recommended: 3,
}

function suspensionMessage(ownershipLost: boolean): string {
  return ownershipLost
    ? 'The Veerify ownership TXT record is no longer found in DNS.'
    : 'The mail provider no longer reports this domain as verified.'
}

/**
 * The pure status transition for one provider + ownership check (design §5.3).
 *
 * - provisioning/failed + provider answer: becomes `pending` (the retry worked).
 * - pending: `verified` once the TXT is valid and the provider is `active`.
 * - verified: suspended after 2 consecutive provider `unverified` answers or 3
 *   consecutive missing TXT lookups; an `unknown` TXT lookup (DNS trouble)
 *   neither counts as a miss nor resets the counter.
 * - suspended: back to `verified` when both checks pass.
 * - deleting: status untouched.
 */
export function applyProviderResult(
  row: SendingDomainTransitionRow,
  result: SendingDomainProviderResultInput,
  ownership: OwnershipCheckResult,
  now: Date
): SendingDomainTransition {
  const bothPass = ownership === 'valid' && result.state === 'active'
  const current = row.status as SupportSendingDomainStatus

  const kept = row.dnsRecords
    .filter((r) => r.purpose === 'ownership' || r.purpose === 'recommended')
    .map((r) => (r.purpose === 'ownership' ? { ...r, status: ownership } : r))
  const dnsRecords = [...kept, ...result.records].sort((a, b) => RECORD_ORDER[a.purpose] - RECORD_ORDER[b.purpose])

  const out: SendingDomainTransition = {
    status: current,
    providerState: result.state,
    receivesViaProvider: result.receivesMail,
    dnsRecords,
    ownershipFailures: row.ownershipFailures,
    providerFailures: row.providerFailures,
    ownershipVerifiedAt: ownership === 'valid' ? (row.ownershipVerifiedAt ?? now) : row.ownershipVerifiedAt,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    lastCheckedAt: now,
    nextCheckAt: null,
    lastErrorCode: null,
    lastError: null,
    updatedAt: now,
  }

  const setStatus = (status: SupportSendingDomainStatus) => {
    out.status = status
    out.nextCheckAt = nextSendingDomainCheckAt(status, pendingPeriodStart(row), now)
  }

  const markVerified = () => {
    setStatus('verified')
    out.verifiedAt = row.verifiedAt ?? now
    out.expiresAt = null
    out.ownershipFailures = 0
    out.providerFailures = 0
  }

  if (current === 'deleting') return out

  if (current === 'pending' || current === 'provisioning' || current === 'failed') {
    if (bothPass && current === 'pending') markVerified()
    else setStatus('pending')
    return out
  }

  // verified | suspended: track consecutive misses.
  out.providerFailures = result.state === 'unverified' ? row.providerFailures + 1 : 0
  out.ownershipFailures =
    ownership === 'invalid' ? row.ownershipFailures + 1 : ownership === 'valid' ? 0 : row.ownershipFailures

  if (current === 'suspended' && bothPass) {
    markVerified()
    return out
  }

  const ownershipLost = out.ownershipFailures >= SUSPEND_AFTER_OWNERSHIP_MISSES
  const providerLost = out.providerFailures >= SUSPEND_AFTER_PROVIDER_MISSES
  if (current === 'suspended' || ownershipLost || providerLost) {
    setStatus('suspended')
    // A suspended claim nobody repairs is released after SUSPENDED_TTL_DAYS. The
    // clock starts at the suspension and is not restarted by the daily checks.
    out.expiresAt =
      current === 'suspended' && row.expiresAt ? row.expiresAt : new Date(now.getTime() + SUSPENDED_TTL_DAYS * DAY)
    const ownershipCause = ownershipLost || (current === 'suspended' && ownership === 'invalid')
    out.lastErrorCode = ownershipCause ? 'ownership_missing' : 'provider_unverified'
    out.lastError = suspensionMessage(ownershipCause)
  } else {
    setStatus('verified')
  }
  return out
}
