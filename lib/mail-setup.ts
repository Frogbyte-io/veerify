/**
 * Pure rules for the custom-domain email setup (Project settings → Email): the
 * per-domain checklist, the MX takeover warning, limit thresholds and the
 * receiving confirmation copy. Shared by the server and the browser, so no
 * Node-only imports. See docs/plans/2026-10-28-email-addresses/design.md → UI.
 */

/** Amazon SES inbound endpoints (`inbound-smtp.<region>.amazonaws.com`): our own receiving MX. */
const SES_INBOUND_HOST = /^inbound-smtp\.[a-z0-9-]+\.amazonaws\.com$/

/** Share of the monthly forward limit at which the Email tab warns. */
export const FORWARD_WARNING_RATIO = 0.8

export type ReceivingStatus = 'pending_verification' | 'pending_mx' | 'active' | 'disabled'

/** Lowercase, no trailing dot. */
export function normalizeMxHost(host: string): string {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

export function isSesInboundHost(host: string): boolean {
  return SES_INBOUND_HOST.test(normalizeMxHost(host))
}

/**
 * The MX hosts a domain already uses, minus our receiving host(s): ordered by
 * preference, deduplicated. `exclude` adds hosts that also count as ours (the
 * MX value Frogmail asked for, in case it is not an SES name). A null MX
 * (`.` / empty exchange, RFC 7505) means "no mail" and is not a mailbox.
 */
export function existingMxHostsFrom(
  records: Array<{ exchange: string; priority: number }>,
  exclude: string[] = []
): string[] {
  const ours = new Set(exclude.map(normalizeMxHost).filter(Boolean))
  const hosts: string[] = []
  for (const record of [...records].sort((a, b) => a.priority - b.priority)) {
    const host = normalizeMxHost(record.exchange)
    if (!host || isSesInboundHost(host) || ours.has(host) || hosts.includes(host)) continue
    hosts.push(host)
  }
  return hosts
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type UsageLevel = 'unknown' | 'ok' | 'warning' | 'limit'

/** `limit` at or over the limit, `warning` from 80 %, `unknown` when either number is missing. */
export function usageLevel(used: number | null | undefined, limit: number | null | undefined): UsageLevel {
  if (typeof used !== 'number' || typeof limit !== 'number' || !Number.isFinite(used) || limit <= 0) return 'unknown'
  if (used >= limit) return 'limit'
  if (used >= limit * FORWARD_WARNING_RATIO) return 'warning'
  return 'ok'
}

export function isAtLimit(used: number | null | undefined, limit: number | null | undefined): boolean {
  return usageLevel(used, limit) === 'limit'
}

// ---------------------------------------------------------------------------
// Per-domain checklist
// ---------------------------------------------------------------------------

/** The slice of a domain (list API view) the checklist reads. */
export interface DomainSetupInput {
  status: string
  receivesViaProvider?: boolean
  receivingStatus?: ReceivingStatus | null
  lastReceivedAt?: string | null
}

export type OwnershipStep = 'waiting' | 'done' | 'problem' | 'removing'
/**
 * - `none`: this deployment does not receive through Frogmail (no step 2).
 * - `locked`: step 1 is not done yet.
 * - `preparing`: verified; the provider is still setting up receiving.
 * - `waiting_mx`: the MX record is the one record left.
 * - `active`: receiving works.
 * - `off`: receiving was switched off for the domain.
 */
export type ReceivingStep = 'none' | 'locked' | 'preparing' | 'waiting_mx' | 'active' | 'off'

export interface DomainSetupState {
  ownership: OwnershipStep
  receiving: ReceivingStep
  /** Every applicable step is done. */
  complete: boolean
  /** Something is expected to change soon, so the page should keep refreshing. */
  inProgress: boolean
}

export function domainSetupState(domain: DomainSetupInput, opts: { forwarding: boolean }): DomainSetupState {
  const ownership: OwnershipStep =
    domain.status === 'verified'
      ? 'done'
      : domain.status === 'deleting'
        ? 'removing'
        : domain.status === 'suspended' || domain.status === 'failed'
          ? 'problem'
          : 'waiting'

  let receiving: ReceivingStep
  if (!opts.forwarding) receiving = 'none'
  else if (ownership !== 'done') receiving = 'locked'
  else if (domain.receivingStatus === 'active') receiving = 'active'
  else if (domain.receivingStatus === 'pending_mx') receiving = 'waiting_mx'
  else if (domain.receivingStatus === 'disabled') receiving = 'off'
  else receiving = 'preparing'

  const complete = ownership === 'done' && (receiving === 'none' || receiving === 'active')
  const inProgress =
    domain.status === 'provisioning' ||
    domain.status === 'pending' ||
    domain.status === 'deleting' ||
    receiving === 'preparing' ||
    receiving === 'waiting_mx'
  return { ownership, receiving, complete, inProgress }
}

// ---------------------------------------------------------------------------
// Receiving confirmation
// ---------------------------------------------------------------------------

/** "just now", "5 min ago", "3 h ago", "2 days ago". Empty for an unreadable date. */
export function formatTimeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  if (diff < 60_000) return 'just now'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** "Receiving active · last message 3 h ago" or "Receiving active · no mail received yet". */
export function receivingActiveLine(lastReceivedAt: string | null | undefined, now: number = Date.now()): string {
  const ago = formatTimeAgo(lastReceivedAt, now)
  return ago ? `Receiving active · last message ${ago}` : 'Receiving active · no mail received yet'
}

/** True once `current` is a later message than `baseline` (the value when the test started). */
export function receivedSince(baseline: string | null | undefined, current: string | null | undefined): boolean {
  if (!current) return false
  const after = new Date(current).getTime()
  if (!Number.isFinite(after)) return false
  if (!baseline) return true
  const before = new Date(baseline).getTime()
  return !Number.isFinite(before) || after > before
}

/**
 * The address to send a test email to: the first exact custom address on the
 * domain, else `test@domain` when a catch-all takes it. Null when the domain
 * has no address yet (step 3 waits for the first one).
 */
export function testAddressForDomain(
  addresses: Array<{ address: string; kind?: string; isCatchAll?: boolean }>,
  domain: string
): string | null {
  const suffix = `@${domain.toLowerCase()}`
  const onDomain = addresses.filter((row) => row.kind !== 'platform' && row.address.toLowerCase().endsWith(suffix))
  const exact = onDomain.find((row) => !row.isCatchAll && !row.address.startsWith('*@'))
  if (exact) return exact.address
  return onDomain.length > 0 ? `test${suffix}` : null
}
