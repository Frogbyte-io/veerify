/**
 * @openapi
 * /api/support/teams/{teamId}/sending-domains:
 *   post:
 *     tags: [Support]
 *     summary: Claim a sending domain and register it with the mail provider
 *     description: >
 *       Team administrators only. Returns 201 once the domain is registered and waiting
 *       for DNS, or 202 when the provider was temporarily unavailable and registration
 *       will be retried in the background.
 *     operationId: createSupportSendingDomain
 *     parameters:
 *       - in: path
 *         name: teamId
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
 *       403: { description: Team administrator required }
 *       404: { description: Feature disabled }
 *       409: { description: Domain claimed by another workspace, owned elsewhere, or a limit was reached }
 *       422: { description: Domain rejected by validation or the provider }
 *       429: { description: Rate limit exceeded }
 *       503: { description: Provider not configured or misconfigured }
 */
import { z } from 'zod'
import { setResponseStatus } from 'h3'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { validateBody } from '~/server/utils/validation'
import { createLogger } from '~/server/utils/logger'
import { recordSupportMetric } from '~/server/utils/support-observability'
import { createSendingDomainClaim, getTeamSendingDomain, toSendingDomainView } from '~/server/utils/sending-domains'
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
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamAdmin(teamId, session.user.id)
  requireSendingDomainsEnabled()
  const body = await validateBody(event, bodySchema)

  await requireRateLimit(event, {
    maxRequests: 10,
    windowSeconds: 60 * 60,
    identifier: 'sending-domain-create',
    subject: `team:${teamId}`,
  })
  await requireRateLimit(event, {
    maxRequests: 5,
    windowSeconds: 60,
    identifier: 'sending-domain-create-user',
    subject: `user:${session.user.id}`,
  })

  const provider = requireConfiguredSendingDomainProvider()

  // Rules, limits and cross-team conflicts (409 DOMAIN_CLAIMED etc.) are enforced
  // under the advisory lock inside the claim helper.
  const claim = await createSendingDomainClaim({
    teamId,
    domain: body.domain,
    userId: session.user.id,
    provider: provider.name,
    providerAccountKey: provider.accountKey,
  })

  const now = new Date()
  await saveSendingDomainPatch(claim, {
    nextCheckAt: new Date(now.getTime() + PROVISIONING_SAFETY_NET_MS),
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
  const row = await getTeamSendingDomain(teamId, claim.id)

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
