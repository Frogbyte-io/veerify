import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  mailForwardDestination,
  projectMailAddress,
  projectMailAddressForward,
  projectMailDomain,
} from '~/server/database/schema/support'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import {
  SendingDomainProviderError,
  type InboundRouteInput,
  type InboundRouteResult,
  type ProviderForwardDestination,
  type SendingDomainErrorCode,
  type SendingDomainProvider,
} from '~/server/services/sending-domains/types'
import { isSendingDomainsEnabled } from '~/server/utils/sending-domains'
import { emailDomain } from '~/server/services/support-channels/types'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('support-inbound-routes')

/**
 * Direct receiving through provider routes (design §9.2).
 *
 * Only for a `custom` address whose domain is exactly a *verified* claim of the
 * inbox's project that the provider reports as receiving mail. Subdomain addresses
 * cannot receive directly (a provider limitation), so only the exact claimed
 * domain matches. A route failure never fails the address operation: the row
 * is marked `failed` and the poller retries on its daily pass.
 */

function inboundForwardUrl(providerName: string): string {
  const configured = (process.env.SUPPORT_INBOUND_WEBHOOK_URL ?? '').trim()
  if (configured) return configured
  const base = (process.env.BETTER_AUTH_URL ?? '').trim().replace(/\/+$/, '')
  return `${base}/api/support/inbound/${providerName}`
}

export interface SyncAddressRouteOptions {
  /** Defaults to the configured provider. */
  provider?: SendingDomainProvider | null
  /** Use this claim (no verified/receiving lookup), e.g. the poller's own row. */
  claimId?: string
  /** New inbox-delivery flag; defaults to the stored one. */
  deliverToInbox?: boolean
  /** New forward emails (lowercase); replaces the stored forwards. Defaults to the stored ones. */
  forwardTo?: string[]
  /** Throw forward-related provider errors instead of marking the route failed. */
  strict?: boolean
}

export interface SyncAddressRouteResult {
  status: 'active' | 'failed' | null
  routeId: string | null
  /** Provider error code of a failed non-strict sync. */
  errorCode: SendingDomainErrorCode | null
}

const NOT_APPLICABLE: SyncAddressRouteResult = { status: null, routeId: null, errorCode: null }

function toProviderError(error: unknown): SendingDomainProviderError {
  if (error instanceof SendingDomainProviderError) return error
  return new SendingDomainProviderError(
    'provider_unavailable',
    error instanceof Error ? error.message : String(error),
    true
  )
}

/** True when the domain claim can carry forwards: receiving is enabled at the provider. */
export function claimReceivesForForwarding(claim: { receivingStatus: string | null }): boolean {
  return Boolean(claim.receivingStatus) && claim.receivingStatus !== 'disabled'
}

/**
 * Create or update the address's provider route from the stored (or overridden)
 * inbox-delivery flag and forwards, then store the route's route id and upsert
 * the forward destinations the provider answers with. Returns `status: null`
 * when direct receiving does not apply. A provider failure never throws unless
 * `strict` (and then only for errors the caller can fix); the row is marked
 * `failed` for the poller's next reconcile.
 */
export async function syncAddressRoute(
  addressId: string,
  options: SyncAddressRouteOptions = {}
): Promise<SyncAddressRouteResult> {
  if (!isSendingDomainsEnabled()) return NOT_APPLICABLE
  const provider = options.provider !== undefined ? options.provider : getSendingDomainProvider()
  if (!provider?.capabilities.inboundRoutes || !provider.createInboundRoute) return NOT_APPLICABLE

  const [address] = await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, addressId)).limit(1)
  if (!address || address.kind !== 'custom') return NOT_APPLICABLE

  const domain = emailDomain(address.address)
  if (!domain) return NOT_APPLICABLE

  const [claim] = await db
    .select({ id: projectMailDomain.id, receivingStatus: projectMailDomain.receivingStatus })
    .from(projectMailDomain)
    .where(
      options.claimId
        ? eq(projectMailDomain.id, options.claimId)
        : and(
            eq(projectMailDomain.projectId, address.projectId),
            eq(projectMailDomain.domain, domain),
            eq(projectMailDomain.status, 'verified'),
            eq(projectMailDomain.receivesViaProvider, true),
            eq(projectMailDomain.provider, provider.name),
            eq(projectMailDomain.providerAccountKey, provider.accountKey)
          )
    )
    .limit(1)
  if (!claim) return NOT_APPLICABLE

  const deliverToInbox = options.deliverToInbox ?? address.deliverToInbox
  const stored = await db
    .select({ email: mailForwardDestination.email })
    .from(projectMailAddressForward)
    .innerJoin(mailForwardDestination, eq(mailForwardDestination.id, projectMailAddressForward.destinationId))
    .where(eq(projectMailAddressForward.addressId, addressId))
  const emails = options.forwardTo ?? stored.map((row) => row.email)

  const forwardingOn = Boolean(provider.capabilities.forwarding) && claimReceivesForForwarding(claim)
  if (emails.length > 0 && !forwardingOn && options.strict) {
    throw new SendingDomainProviderError(
      'forward_requires_ses',
      'Forwarding is not available for this domain yet.',
      false
    )
  }
  const forwardTo = forwardingOn ? emails : []
  // A forward-only address with nothing to forward to has no route to build.
  if (!deliverToInbox && forwardTo.length === 0) return NOT_APPLICABLE

  const input: InboundRouteInput = {
    address: address.address,
    forwardUrl: deliverToInbox ? inboundForwardUrl(provider.name) : null,
    ...(forwardTo.length > 0 || provider.capabilities.forwarding ? { forwardTo } : {}),
    description: `veerify:${address.inboxId}:${address.id}`,
  }

  let routeId: string | null = null
  let destinations: ProviderForwardDestination[] = []
  let failure: SendingDomainProviderError | null = null
  try {
    let route: InboundRouteResult
    if (address.providerRouteId && provider.updateInboundRoute) {
      try {
        route = await provider.updateInboundRoute(address.providerRouteId, input)
      } catch (raw) {
        if (toProviderError(raw).code !== 'not_found') throw raw
        route = await provider.createInboundRoute(input)
      }
    } else {
      route = await provider.createInboundRoute(input)
    }
    routeId = route.routeId
    destinations = route.forwardDestinations ?? []
  } catch (raw) {
    failure = toProviderError(raw)
    if (options.strict && FORWARD_ERROR_CODES.includes(failure.code)) throw failure
    logger.warn('Inbound route sync failed; address kept with route status failed', {
      addressId,
      code: failure.code,
      error: failure.message,
    })
  }

  if (failure) {
    await db
      .update(projectMailAddress)
      .set({ providerRouteStatus: 'failed' })
      .where(eq(projectMailAddress.id, addressId))
    return { status: 'failed', routeId: address.providerRouteId, errorCode: failure.code }
  }

  await db
    .update(projectMailAddress)
    .set({ providerRouteId: routeId, providerRouteStatus: 'active' })
    .where(eq(projectMailAddress.id, addressId))
  await storeRouteDestinations({
    projectId: address.projectId,
    domainId: claim.id,
    addressId,
    destinations,
    replaceLinks: options.forwardTo !== undefined,
  })
  return { status: 'active', routeId, errorCode: null }
}

/** Provider errors a user can fix by changing the forwards. */
export const FORWARD_ERROR_CODES: SendingDomainErrorCode[] = [
  'forward_destination_invalid',
  'forward_would_loop',
  'forward_requires_ses',
  'forward_requires_domain',
  'verification_throttled',
  'receiving_unavailable',
  'domain_not_receiving',
]

/**
 * Upsert the destinations a route response carries (consent is per domain) and
 * point the address's links at exactly those.
 */
export async function storeRouteDestinations(input: {
  projectId: string
  domainId: string
  addressId: string
  destinations: ProviderForwardDestination[]
  replaceLinks: boolean
}): Promise<void> {
  const now = new Date()
  const ids: string[] = []
  for (const destination of input.destinations) {
    const email = destination.email.trim().toLowerCase()
    const [row] = await db
      .insert(mailForwardDestination)
      .values({
        id: randomUUID(),
        projectId: input.projectId,
        domainId: input.domainId,
        email,
        frogmailDestinationId: destination.id,
        status: destination.status,
        statusReason: destination.statusReason,
        verificationSentAt: destination.verificationSentAt,
        verifiedAt: destination.verifiedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mailForwardDestination.domainId, mailForwardDestination.email],
        set: {
          frogmailDestinationId: destination.id,
          status: destination.status,
          // A route response carries no reason: keep the stored one unless the status moved on.
          statusReason:
            destination.statusReason ??
            sql`case when ${mailForwardDestination.status} = ${destination.status} then ${mailForwardDestination.statusReason} else null end`,
          verificationSentAt: destination.verificationSentAt
            ? destination.verificationSentAt
            : sql`${mailForwardDestination.verificationSentAt}`,
          verifiedAt: destination.verifiedAt ? destination.verifiedAt : sql`${mailForwardDestination.verifiedAt}`,
          updatedAt: now,
        },
      })
      .returning({ id: mailForwardDestination.id })
    if (row) ids.push(row.id)
  }

  if (input.replaceLinks) {
    await db.transaction(async (tx) => {
      await tx.delete(projectMailAddressForward).where(eq(projectMailAddressForward.addressId, input.addressId))
      if (ids.length > 0) {
        await tx
          .insert(projectMailAddressForward)
          .values(ids.map((destinationId) => ({ addressId: input.addressId, destinationId })))
          .onConflictDoNothing()
      }
    })
  }
}

/**
 * Create the provider route for a freshly added address when direct receiving
 * applies. Returns the resulting route status, or null when it does not apply.
 * `deliverToInbox` and `forwardTo` override the stored values (a new address
 * has no forwards stored yet); `strict` rethrows forward errors.
 */
export async function createDirectRouteForAddress(input: {
  projectId: string
  inboxId: string
  address: { id: string; address: string; kind: string }
  deliverToInbox?: boolean
  forwardTo?: string[]
  strict?: boolean
}): Promise<'active' | 'failed' | null> {
  const result = await syncAddressRoute(input.address.id, {
    deliverToInbox: input.deliverToInbox,
    forwardTo: input.forwardTo,
    strict: input.strict,
  })
  return result.status
}

/** Best-effort removal of an address's provider route. Never throws. */
export async function deleteDirectRouteForAddress(address: {
  id: string
  providerRouteId: string | null
}): Promise<void> {
  if (!address.providerRouteId) return

  const provider = getSendingDomainProvider()
  if (!provider?.deleteInboundRoute) return

  try {
    await provider.deleteInboundRoute(address.providerRouteId)
  } catch (error) {
    // A stray route forwards mail to an address no inbox matches any more:
    // harmless (recorded as no-matching-inbox) but worth a log line.
    logger.warn('Inbound route deletion failed', {
      addressId: address.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
