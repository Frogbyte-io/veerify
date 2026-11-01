/**
 * @openapi
 * /api/support/projects/{projectId}/sending-domains:
 *   post:
 *     tags: [Support]
 *     summary: Claim a sending domain and register it with the mail provider
 *     description: >
 *       Project administrators only. Returns 201 once the domain is registered and waiting
 *       for DNS, or 202 when the provider was temporarily unavailable and registration
 *       will be retried in the background. Where the deployment receives mail (forwarding),
 *       the domain's current MX hosts are looked up so `existingMxHosts` can warn that the
 *       receiving MX moves all of the domain's mail; a DNS failure leaves it null.
 *     operationId: createSupportSendingDomain
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domain]
 *             properties:
 *               domain: { type: string, example: acme.com }
 *     responses:
 *       201: { description: Domain claimed and registered }
 *       202: { description: Domain claimed; registration will be retried }
 *       400: { description: Invalid request }
 *       403: { description: Project administrator required }
 *       404: { description: Feature disabled }
 *       409: { description: "Domain claimed by another workspace, owned elsewhere, or a workspace mail limit was reached (MAIL_DOMAIN_LIMIT_REACHED, MAIL_PENDING_LIMIT_REACHED)" }
 *       422: { description: Domain rejected by validation or the provider }
 *       429: { description: Rate limit exceeded }
 *       503: { description: Provider not configured or misconfigured }
 */
import { z } from 'zod'
import { setResponseStatus } from 'h3'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { validateBody } from '~/server/utils/validation'
import { createLogger } from '~/server/utils/logger'
import { recordSupportMetric } from '~/server/utils/support-observability'
import { createSendingDomainClaim, getProjectSendingDomain, toSendingDomainView } from '~/server/utils/sending-domains'
import { refreshExistingMxHosts } from '~/server/utils/mail-domain-mx'
import {
  deleteSendingDomainRow,
  registerSendingDomainClaim,
  saveSendingDomainPatch,
} from '~/server/utils/sending-domain-poller'
import {
  providerMisconfiguredError,
  registerOutcomeToError,
  requireConfiguredSendingDomainProvider,
  requireSendingDomainsEnabled,
} from '~/server/utils/sending-domain-api'

const logger = createLogger('sending-domains')

const bodySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required').max(253),
})

/** Safety net: if this request dies between insert and register, the poller still picks the row up. */
const PROVISIONING_SAFETY_NET_MS = 2 * 60 * 1000

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAdmin(projectId, session.user.id)
  requireSendingDomainsEnabled()
  const body = await validateBody(event, bodySchema)

  await requireRateLimit(event, {
    maxRequests: 10,
    windowSeconds: 60 * 60,
    identifier: 'sending-domain-create',
    subject: `project:${projectId}`,
  })
  await requireRateLimit(event, {
    maxRequests: 5,
    windowSeconds: 60,
    identifier: 'sending-domain-create-user',
    subject: `user:${session.user.id}`,
  })

  const provider = requireConfiguredSendingDomainProvider()

  // Rules, limits and cross-project conflicts (409 DOMAIN_CLAIMED etc.) are enforced
  // under the advisory lock inside the claim helper.
  const claim = await createSendingDomainClaim({
    projectId,
    domain: body.domain,
    userId: session.user.id,
    provider: provider.name,
    providerAccountKey: provider.accountKey,
  })

  const now = new Date()
  await saveSendingDomainPatch(claim, {
    nextCheckAt: new Date(now.getTime() + PROVISIONING_SAFETY_NET_MS),
    // Held while the provider call is in flight so an admin delete cannot leak the
    // provider domain (409 DOMAIN_BUSY); every outcome patch clears it.
    leaseExpiresAt: new Date(now.getTime() + PROVISIONING_SAFETY_NET_MS),
    updatedAt: now,
  })

  const outcome = await registerSendingDomainClaim(claim, provider, { now })

  if (outcome.kind === 'rejected' || outcome.kind === 'misconfigured') {
    // Nothing stays claimed after a permanent refusal (design §4.3).
    await deleteSendingDomainRow(claim)
    if (outcome.kind === 'misconfigured') {
      logger.error('Sending-domain provider rejected our credentials', { provider: provider.name, code: outcome.code })
      recordSupportMetric('support.sending_domain.provider_misconfigured', { provider: provider.name })
      throw providerMisconfiguredError()
    }
    throw registerOutcomeToError(outcome)
  }

  await saveSendingDomainPatch(claim, outcome.patch)
  // The MX takeover warning needs the domain's current mail hosts straight away. Short timeout,
  // never fails the request; each poll looks again while receiving is not active.
  if (provider.capabilities.forwarding) {
    await refreshExistingMxHosts({ id: claim.id, domain: claim.domain, receivingStatus: null })
  }
  const row = await getProjectSendingDomain(projectId, claim.id)

  if (outcome.kind === 'transient') {
    recordSupportMetric('support.sending_domain.failed', {
      domainId: claim.id,
      provider: provider.name,
      status: 'failed',
      outcome: outcome.code,
    })
    setResponseStatus(event, 202)
  } else {
    setResponseStatus(event, 201)
  }
  return createSuccessResponse(toSendingDomainView(row, provider))
})
