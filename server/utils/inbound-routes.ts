import { randomUUID } from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
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
  /** The synced route delivers to the inbox only because no forward is confirmed yet. */
  inboxFallback?: boolean
}

export interface RouteDeliveryPlan {
  /** The route carries the inbox `forward(url)` action. */
  toInbox: boolean
  /** True when `toInbox` comes only from the forward-only fallback. */
  inboxFallback: boolean
  /** Email forwards the route carries. */
  forwardTo: string[]
}

/**
 * What a route delivers to. A forward-only address keeps delivering to the
 * inbox until at least one of its forwards is confirmed (verified): Frogmail
 * forwards only to confirmed mailboxes, so without the inbox action mail sent
 * before the first confirmation would reach nobody. The fallback also covers
 * forwarding being unavailable (no forwards on the route at all).
 */
export function planRouteDelivery(input: {
  deliverToInbox: boolean
  forwardTo: string[]
  verifiedEmails: Iterable<string>
}): RouteDeliveryPlan {
  const verified = new Set([...input.verifiedEmails].map((email) => email.trim().toLowerCase()))
  const anyConfirmed = input.forwardTo.some((email) => verified.has(email.trim().toLowerCase()))
  const inboxFallback = !input.deliverToInbox && !anyConfirmed
  return { toInbox: input.deliverToInbox || inboxFallback, inboxFallback, forwardTo: input.forwardTo }
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
  let plan = planRouteDelivery({
    deliverToInbox,
    forwardTo,
    verifiedEmails: await loadVerifiedEmails(claim.id, forwardTo),
  })
  // Nothing to deliver to (cannot happen with the fallback, kept as a guard).
  if (!plan.toInbox && plan.forwardTo.length === 0) return NOT_APPLICABLE

  const inputFor = (next: RouteDeliveryPlan): InboundRouteInput => ({
    address: address.address,
    forwardUrl: next.toInbox ? inboundForwardUrl(provider.name) : null,
    ...(next.forwardTo.length > 0 || provider.capabilities.forwarding ? { forwardTo: next.forwardTo } : {}),
    description: `veerify:${address.inboxId}:${address.id}`,
  })

  let routeId: string | null = null
  let destinations: ProviderForwardDestination[] = []
  let failure: SendingDomainProviderError | null = null
  try {
    let route: InboundRouteResult
    const input = inputFor(plan)
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

    // The provider's answer is the authority on confirmation (consent is per
    // domain, so a new forward can already be confirmed). When it disagrees with
    // the local view, rebuild once with the provider's statuses.
    if (!deliverToInbox && destinations.length > 0 && provider.updateInboundRoute) {
      const confirmed = planRouteDelivery({
        deliverToInbox,
        forwardTo,
        verifiedEmails: destinations.filter((item) => item.status === 'verified').map((item) => item.email),
      })
      if (confirmed.inboxFallback !== plan.inboxFallback) {
        plan = confirmed
        route = await provider.updateInboundRoute(route.routeId, inputFor(plan))
        destinations = route.forwardDestinations?.length ? route.forwardDestinations : destinations
      }
    }
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
    .set({ providerRouteId: routeId, providerRouteStatus: 'active', providerRouteInboxFallback: plan.inboxFallback })
    .where(eq(projectMailAddress.id, addressId))
  await storeRouteDestinations({
    projectId: address.projectId,
    domainId: claim.id,
    addressId,
    destinations,
    replaceLinks: options.forwardTo !== undefined,
  })
  return { status: 'active', routeId, errorCode: null, inboxFallback: plan.inboxFallback }
}

/** The subset of `emails` confirmed (verified) as forward destinations on the domain claim. */
async function loadVerifiedEmails(domainId: string, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return []
  const rows = await db
    .select({ email: mailForwardDestination.email })
    .from(mailForwardDestination)
    .where(
      and(
        eq(mailForwardDestination.domainId, domainId),
        eq(mailForwardDestination.status, 'verified'),
        inArray(mailForwardDestination.email, emails)
      )
    )
  return rows.map((row) => row.email)
}

/**
 * Rebuild the routes of forward-only addresses whose inbox fallback no longer
 * matches their forwards: the first forward got confirmed (drop the inbox
 * action) or the last confirmed one was revoked or suspended (deliver to the
 * inbox again). Scoped to the addresses linked to `destinationIds`, or to every
 * forward-only address on the domain claim `domainId`.
 *
 * Idempotent and cheap: an address whose stored fallback already matches is
 * skipped without a provider call, so it runs after every destination status
 * change (Frogmail webhook, the poller's reconcile, resend and revoke). Never
 * throws; returns the number of addresses re-synced.
 */
export async function resyncForwardOnlyRoutes(
  scope: { destinationIds?: string[]; domainId?: string },
  options: { provider?: SendingDomainProvider | null } = {}
): Promise<number> {
  try {
    const destinationIds = scope.destinationIds ?? []
    if (destinationIds.length === 0 && !scope.domainId) return 0

    const linked = (ids: string[]) =>
      db
        .select({ addressId: projectMailAddressForward.addressId })
        .from(projectMailAddressForward)
        .where(inArray(projectMailAddressForward.destinationId, ids))
    const onDomain = scope.domainId
      ? db
          .select({ addressId: projectMailAddressForward.addressId })
          .from(projectMailAddressForward)
          .innerJoin(mailForwardDestination, eq(mailForwardDestination.id, projectMailAddressForward.destinationId))
          .where(eq(mailForwardDestination.domainId, scope.domainId))
      : null

    const conditions = [
      ...(destinationIds.length > 0 ? [inArray(projectMailAddress.id, linked(destinationIds))] : []),
      ...(scope.domainId && onDomain
        ? [eq(projectMailAddress.domainId, scope.domainId), inArray(projectMailAddress.id, onDomain)]
        : []),
    ]
    const candidates = await db
      .select({ id: projectMailAddress.id, inboxFallback: projectMailAddress.providerRouteInboxFallback })
      .from(projectMailAddress)
      .where(
        and(
          eq(projectMailAddress.deliverToInbox, false),
          eq(projectMailAddress.kind, 'custom'),
          conditions.length === 1 ? conditions[0] : or(...conditions)
        )
      )
    if (candidates.length === 0) return 0

    const statuses = await db
      .select({ addressId: projectMailAddressForward.addressId, status: mailForwardDestination.status })
      .from(projectMailAddressForward)
      .innerJoin(mailForwardDestination, eq(mailForwardDestination.id, projectMailAddressForward.destinationId))
      .where(
        inArray(
          projectMailAddressForward.addressId,
          candidates.map((candidate) => candidate.id)
        )
      )
    const confirmed = new Set(statuses.filter((row) => row.status === 'verified').map((row) => row.addressId))

    let resynced = 0
    for (const candidate of candidates) {
      const wantsFallback = !confirmed.has(candidate.id)
      if (wantsFallback === candidate.inboxFallback) continue
      const result = await syncAddressRoute(
        candidate.id,
        options.provider !== undefined ? { provider: options.provider } : {}
      )
      if (result.status === 'active') resynced++
    }
    return resynced
  } catch (error) {
    logger.warn('Forward-only route resync failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
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
