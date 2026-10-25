import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportInboxAddress, supportSendingDomain } from '~/server/database/schema/support'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
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

/**
 * Create the provider route for a freshly added address when direct receiving
 * applies. Returns the resulting route status, or null when it does not apply.
 */
export async function createDirectRouteForAddress(input: {
  projectId: string
  inboxId: string
  address: { id: string; address: string; kind: string }
}): Promise<'active' | 'failed' | null> {
  if (!isSendingDomainsEnabled() || input.address.kind !== 'custom') return null

  const provider = getSendingDomainProvider()
  if (!provider?.capabilities.inboundRoutes || !provider.createInboundRoute) return null

  const domain = emailDomain(input.address.address)
  if (!domain) return null

  const [claim] = await db
    .select({ id: supportSendingDomain.id })
    .from(supportSendingDomain)
    .where(
      and(
        eq(supportSendingDomain.projectId, input.projectId),
        eq(supportSendingDomain.domain, domain),
        eq(supportSendingDomain.status, 'verified'),
        eq(supportSendingDomain.receivesViaProvider, true),
        eq(supportSendingDomain.provider, provider.name),
        eq(supportSendingDomain.providerAccountKey, provider.accountKey)
      )
    )
    .limit(1)
  if (!claim) return null

  let routeId: string | null = null
  try {
    const route = await provider.createInboundRoute({
      address: input.address.address,
      forwardUrl: inboundForwardUrl(provider.name),
      description: `veerify:${input.inboxId}:${input.address.id}`,
    })
    routeId = route.routeId
  } catch (error) {
    logger.warn('Inbound route creation failed; address kept with route status failed', {
      addressId: input.address.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const status = routeId ? 'active' : 'failed'
  await db
    .update(supportInboxAddress)
    .set({ providerRouteId: routeId, providerRouteStatus: status })
    .where(eq(supportInboxAddress.id, input.address.id))
  return status
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
