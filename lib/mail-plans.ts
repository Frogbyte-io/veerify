/**
 * Mail tiers and their limits, counted per workspace (organization).
 * A workspace without a `mail_entitlement` row is on `standard`. `owner` is
 * Frogbyte's own tier, set with `yarn mail:set-tier`. See
 * docs/plans/2026-10-28-email-addresses/design.md → Limits.
 */

export type MailTier = 'standard' | 'owner'

export interface MailLimits {
  /** Mail domains across all projects of the workspace, pending ones included. */
  domains: number
  /** Domains waiting for DNS verification at the same time. */
  pendingDomains: number
  /** Custom addresses (catch-alls included; platform forwarding addresses are not counted). */
  addresses: number
  /** Forwards to external addresses per calendar month (UTC). Enforced once forwarding ships. */
  forwardsPerMonth: number
}

export const MAIL_TIERS: Record<MailTier, MailLimits> = {
  standard: { domains: 3, pendingDomains: 3, addresses: 20, forwardsPerMonth: 5000 },
  owner: { domains: 69, pendingDomains: 3, addresses: 420, forwardsPerMonth: 1337 },
}

export const MAIL_TIER_KEYS = Object.keys(MAIL_TIERS) as MailTier[]

export const DEFAULT_MAIL_TIER: MailTier = 'standard'

export function isMailTier(value: unknown): value is MailTier {
  return typeof value === 'string' && (MAIL_TIER_KEYS as string[]).includes(value)
}

export function mailLimitsFor(tier: MailTier | null | undefined): MailLimits {
  return MAIL_TIERS[isMailTier(tier) ? tier : DEFAULT_MAIL_TIER]
}

/** What the workspace uses now, as returned by the mail usage endpoints. */
export interface MailUsage {
  tier: MailTier
  limits: MailLimits
  used: {
    domains: number
    pendingDomains: number
    addresses: number
    /** Null until forwarding ships (E3). */
    forwardsThisMonth: number | null
  }
}
