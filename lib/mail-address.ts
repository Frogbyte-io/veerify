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
  /** False for a forward-only address: its route has no inbox action. */
  deliverToInbox: boolean
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
