/**
 * Project mail addresses: shared types and helpers for the Email tab, the
 * address API and inbound routing. See
 * docs/plans/2026-10-28-email-addresses/design.md.
 */

/**
 * `helpdesk`: the inbox's auto-reply, SLA, CSAT and automation rules apply.
 * `mail`: plain mail; none of those run for conversations started on the address.
 */
export type MailAddressBehaviour = 'mail' | 'helpdesk'

export const MAIL_ADDRESS_BEHAVIOURS: readonly MailAddressBehaviour[] = ['mail', 'helpdesk']

export const DEFAULT_MAIL_ADDRESS_BEHAVIOUR: MailAddressBehaviour = 'helpdesk'

/** Local part that marks a catch-all: `*@newsite.com` takes mail to any unlisted address on the domain. */
export const CATCH_ALL_LOCAL_PART = '*'

export function isMailAddressBehaviour(value: unknown): value is MailAddressBehaviour {
  return typeof value === 'string' && (MAIL_ADDRESS_BEHAVIOURS as readonly string[]).includes(value)
}

/** Splits a lowercase address at its last `@`. Null when either side is empty. */
export function splitMailAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  return { localPart: address.slice(0, at), domain: address.slice(at + 1) }
}

export function isCatchAllAddress(address: string): boolean {
  return splitMailAddress(address)?.localPart === CATCH_ALL_LOCAL_PART
}

export function catchAllAddressFor(domain: string): string {
  return `${CATCH_ALL_LOCAL_PART}@${domain.toLowerCase()}`
}

/** One address in the project-level list (`GET /api/projects/{slug}/mail/addresses`). */
export interface ProjectMailAddressItem {
  id: string
  address: string
  isCatchAll: boolean
  kind: 'custom' | 'platform'
  isPrimary: boolean
  behaviour: MailAddressBehaviour
  inboxId: string
  inboxName: string
  productId: string | null
  productName: string | null
  domainId: string | null
  /** Provider inbound route state; null when mail arrives by forwarding instead of a direct route. */
  routeStatus: 'active' | 'failed' | null
  /** False for a forward-only address: its route has no inbox action once a forward is confirmed. */
  deliverToInbox: boolean
  /**
   * True for a forward-only address whose route still delivers to the inbox
   * because none of its forwards is confirmed yet.
   */
  inboxFallback: boolean
  forwards: ProjectMailAddressForward[]
  createdAt: string
}

export type MailForwardStatus = 'pending' | 'verified' | 'revoked' | 'suspended'

/** One forward destination of an address, mirrored from Frogmail. */
export interface ProjectMailAddressForward {
  id: string
  email: string
  status: MailForwardStatus
  statusReason: string | null
  /** ISO time the confirmation mail went out; null = not sent yet. */
  verificationSentAt: string | null
}

/** Plain-language status of a forward, shown as text (never colour or a tooltip alone). */
export function forwardStatusLabel(forward: Pick<ProjectMailAddressForward, 'status' | 'statusReason'>): string {
  switch (forward.status) {
    case 'verified':
      return 'Forwarding'
    case 'suspended':
      return 'Suspended – bounced'
    case 'revoked':
      if (forward.statusReason === 'expired') return 'Confirmation expired'
      if (forward.statusReason === 'api' || forward.statusReason === 'domain_disabled') return 'Stopped'
      return 'Stopped by recipient'
    default:
      return 'Waiting for confirmation'
  }
}

/**
 * A confirmation email can be (re)sent: still waiting, bounced, or the link
 * expired. A recipient who stopped forwarding themselves is not asked again.
 */
export function canResendForwardConfirmation(
  forward: Pick<ProjectMailAddressForward, 'status' | 'statusReason'>
): boolean {
  if (forward.status === 'pending' || forward.status === 'suspended') return true
  return forward.status === 'revoked' && forward.statusReason === 'expired'
}

/** Shown on a forward-only address while its route falls back to the inbox. */
export const INBOX_FALLBACK_NOTE = 'Delivering to the Inbox until a forwarding address is confirmed.'

export interface ProjectMailDomainItem {
  id: string
  domain: string
  /** Null until receiving is enabled. */
  receivingStatus: 'pending_verification' | 'pending_mx' | 'active' | 'disabled' | null
  forwardingPaused: boolean
}

/** Response of `GET /api/projects/{slug}/mail/addresses`. */
export interface ProjectMailAddressesResponse {
  addresses: ProjectMailAddressItem[]
  domains: ProjectMailDomainItem[]
  /** Provider capability: false when forwarding is off (E2 behaviour, hide Forward). */
  forwarding: boolean
}
