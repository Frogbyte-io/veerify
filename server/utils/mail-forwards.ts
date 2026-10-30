/**
 * Email forwarding rules shared by the address API and the destination
 * endpoints (E3, docs/plans/2026-10-28-email-addresses/design.md → E3 build).
 */
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { mailForwardDestination, projectMailAddressForward, projectMailDomain } from '~/server/database/schema/support'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { MAX_ROUTE_FORWARDS } from '~/server/services/sending-domains/providers/mailgun'
import { SendingDomainProviderError } from '~/server/services/sending-domains/types'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { claimReceivesForForwarding } from '~/server/utils/inbound-routes'
import { addressError } from '~/server/utils/inbox-address-rules'
import { ErrorCode } from '~/server/utils/response'
import { splitMailAddress } from '~/lib/mail-address'
import type { MailForwardStatus, ProjectMailAddressForward } from '~/lib/mail-address'

export const MAX_ADDRESS_FORWARDS = MAX_ROUTE_FORWARDS

const emailSchema = z.string().email()

/** Trim, lowercase, validate and deduplicate forward emails. Null when one is not an email address. */
export function normalizeForwardTo(raw: string[]): { ok: true; emails: string[] } | { ok: false; message: string } {
  const emails: string[] = []
  for (const value of raw) {
    const email = value.trim().toLowerCase()
    if (!email || email.length > 320 || !emailSchema.safeParse(email).success) {
      return { ok: false, message: `${value.trim() || 'An empty value'} is not a valid email address.` }
    }
    if (!emails.includes(email)) emails.push(email)
  }
  if (emails.length > MAX_ADDRESS_FORWARDS) {
    return { ok: false, message: `An address can forward to at most ${MAX_ADDRESS_FORWARDS} mailboxes.` }
  }
  return { ok: true, emails }
}

/** The effective delivery must reach somewhere: the inbox, a forward, or both. */
export function assertDeliveryTargets(deliverToInbox: boolean, forwardTo: string[]): void {
  if (!deliverToInbox && forwardTo.length === 0) {
    throw addressError(400, ErrorCode.VALIDATION_ERROR, 'Deliver to the inbox, forward to an address, or both.')
  }
}

/**
 * Forwards need a provider with forwarding and a verified claim of the project
 * for the address's domain with receiving enabled; forwarding to a mailbox on
 * the same domain would loop. Throws 400/409/422; returns the claim id.
 */
export async function assertForwardsAllowed(input: {
  projectId: string
  address: string
  forwardTo: string[]
}): Promise<string> {
  const provider = isSendingDomainsEnabled() ? getSendingDomainProvider() : null
  if (!provider?.capabilities.forwarding) {
    throw addressError(409, 'FORWARDING_UNAVAILABLE', 'Email forwarding is not available on this deployment.')
  }
  const domain = splitMailAddress(input.address)?.domain
  if (!domain) throw addressError(400, ErrorCode.VALIDATION_ERROR, 'Enter an email address.')

  const [claim] = await db
    .select({
      id: projectMailDomain.id,
      receivingStatus: projectMailDomain.receivingStatus,
      provider: projectMailDomain.provider,
      accountKey: projectMailDomain.providerAccountKey,
    })
    .from(projectMailDomain)
    .where(
      and(
        eq(projectMailDomain.projectId, input.projectId),
        eq(projectMailDomain.domain, domain),
        eq(projectMailDomain.status, 'verified')
      )
    )
    .limit(1)
  if (!claim || claim.provider !== provider.name || claim.accountKey !== provider.accountKey) {
    throw addressError(
      422,
      'FORWARD_DOMAIN_UNVERIFIED',
      'Forwarding needs a verified domain on this project. Verify the domain first.'
    )
  }
  if (!claimReceivesForForwarding(claim)) {
    throw addressError(
      409,
      'FORWARD_RECEIVING_UNAVAILABLE',
      'This domain cannot receive mail through Veerify yet, so it cannot forward. Check the domain settings.'
    )
  }
  for (const email of input.forwardTo) {
    if (splitMailAddress(email)?.domain === domain) {
      throw addressError(
        400,
        ErrorCode.VALIDATION_ERROR,
        `${email} is on ${domain} itself, so forwarding to it would loop. Use an address on another domain.`
      )
    }
  }
  return claim.id
}

/** Maps a provider error from a route or destination call to an API error. */
export function mapForwardProviderError(error: unknown) {
  if (!(error instanceof SendingDomainProviderError)) return error
  switch (error.code) {
    case 'forward_destination_invalid':
      return addressError(400, ErrorCode.VALIDATION_ERROR, 'One of the forward addresses cannot be used.')
    case 'forward_would_loop':
      return addressError(400, ErrorCode.VALIDATION_ERROR, 'Forwarding to this address would loop mail back to itself.')
    case 'forward_requires_ses':
    case 'forward_requires_domain':
    case 'domain_not_receiving':
    case 'receiving_unavailable':
      return addressError(
        409,
        'FORWARD_RECEIVING_UNAVAILABLE',
        'This domain cannot receive mail through Veerify yet, so it cannot forward.'
      )
    case 'verification_throttled':
      return addressError(
        409,
        'FORWARD_VERIFICATION_THROTTLED',
        'Too many confirmation emails were sent recently. Try again later.'
      )
    default:
      return error
  }
}

/** The forwards of several addresses, grouped by address id. */
export async function loadAddressForwards(addressIds: string[]): Promise<Map<string, ProjectMailAddressForward[]>> {
  const map = new Map<string, ProjectMailAddressForward[]>()
  if (addressIds.length === 0) return map
  const rows = await db
    .select({
      addressId: projectMailAddressForward.addressId,
      id: mailForwardDestination.id,
      email: mailForwardDestination.email,
      status: mailForwardDestination.status,
      statusReason: mailForwardDestination.statusReason,
      verificationSentAt: mailForwardDestination.verificationSentAt,
    })
    .from(projectMailAddressForward)
    .innerJoin(mailForwardDestination, eq(mailForwardDestination.id, projectMailAddressForward.destinationId))
    .where(inArray(projectMailAddressForward.addressId, addressIds))
  for (const row of rows) {
    const list = map.get(row.addressId) ?? []
    list.push({
      id: row.id,
      email: row.email,
      status: row.status as MailForwardStatus,
      statusReason: row.statusReason ?? null,
      verificationSentAt: row.verificationSentAt ? new Date(row.verificationSentAt).toISOString() : null,
    })
    map.set(row.addressId, list)
  }
  for (const list of map.values()) list.sort((a, b) => (a.email < b.email ? -1 : 1))
  return map
}
