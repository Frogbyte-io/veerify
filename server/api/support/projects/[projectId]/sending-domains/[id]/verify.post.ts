/**
 * @openapi
 * /api/support/projects/{projectId}/sending-domains/{id}/verify:
 *   post:
 *     tags: [Support]
 *     summary: Re-check a sending domain now
 *     description: >
 *       Project administrators only. For failed, provisioning or provider-mismatched claims
 *       this registers the domain again; otherwise it asks the provider to re-verify and
 *       re-checks the Veerify ownership TXT record and DMARC. Where the deployment receives
 *       mail, it also refreshes the receiving status, `lastReceivedAt` and the MX record.
 *       Returns the updated claim.
 *     operationId: verifySupportSendingDomain
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated sending domain }
 *       202: { description: Provider temporarily unavailable; registration will be retried }
 *       403: { description: Project administrator required }
 *       404: { description: Feature disabled, or the domain does not belong to this project }
 *       409: { description: Domain is being removed, or is owned by another service }
 *       422: { description: Domain rejected by the provider }
 *       429: { description: Rate limit exceeded }
 *       502: { description: Provider error }
 *       503: { description: Provider not configured, misconfigured, or unavailable }
 */
import { createError, setResponseHeader, setResponseStatus } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createLogger } from '~/server/utils/logger'
import { recordSupportMetric } from '~/server/utils/support-observability'
import { getProjectSendingDomain, toSendingDomainView } from '~/server/utils/sending-domains'
import {
  checkSendingDomainClaim,
  pendingExpiryFrom,
  isProviderMismatch,
  registerSendingDomainClaim,
  saveSendingDomainPatch,
  syncDomainReceiving,
  type SendingDomainRow,
} from '~/server/utils/sending-domain-poller'
import {
  acquireSendingDomainLease,
  domainBusyError,
  releaseSendingDomainLease,
  providerMisconfiguredError,
  registerOutcomeToError,
  requireConfiguredSendingDomainProvider,
  requireSendingDomainsEnabled,
} from '~/server/utils/sending-domain-api'
import { syncDeliveryWebhooks } from '~/server/utils/sending-domain-webhooks'

const logger = createLogger('sending-domains')

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const id = getRouterParam(event, 'id') as string
  await requireProjectAdmin(projectId, session.user.id)
  requireSendingDomainsEnabled()

  const claim = await getProjectSendingDomain(projectId, id)

  await requireRateLimit(event, {
    maxRequests: 1,
    windowSeconds: 20,
    identifier: 'sending-domain-verify',
    subject: `domain:${claim.id}`,
  })
  await requireRateLimit(event, {
    maxRequests: 60,
    windowSeconds: 60 * 60,
    identifier: 'sending-domain-verify-project',
    subject: `project:${projectId}`,
  })

  if (claim.status === 'deleting') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This domain is being removed'),
    })
  }

  const provider = requireConfiguredSendingDomainProvider()
  const now = new Date()
  const reload = () => getProjectSendingDomain(projectId, claim.id)

  // Hold the row while talking to the provider: an admin delete (or a poll pass)
  // must not interleave with a register in flight, or the provider domain leaks.
  if (!(await acquireSendingDomainLease(claim, now))) throw domainBusyError()
  try {
    return await verifyClaim(event, claim, provider, now, reload)
  } finally {
    await releaseSendingDomainLease(claim)
  }
})

async function verifyClaim(
  event: Parameters<typeof setResponseStatus>[0],
  claim: SendingDomainRow,
  provider: ReturnType<typeof requireConfiguredSendingDomainProvider>,
  now: Date,
  reload: () => Promise<SendingDomainRow>
) {
  const mustRegister =
    claim.status === 'failed' || claim.status === 'provisioning' || isProviderMismatch(claim, provider)
  if (mustRegister) {
    // An admin click restarts the attempt budget (the attempt count itself is kept:
    // it records that an earlier attempt of ours may have created the domain).
    const outcome = await registerSendingDomainClaim(claim, provider, { now, restartBudget: true })
    return respondToRegister(event, claim, outcome, reload)
  }

  const outcome = await checkSendingDomainClaim(claim, provider, { now, manual: true })

  if (outcome.kind === 'needs_register') {
    const registered = await registerSendingDomainClaim(claim, provider, { now, restartBudget: true })
    return respondToRegister(event, claim, registered, reload)
  }

  if (outcome.kind === 'provider_error') {
    const { error } = outcome
    if (outcome.patch) await saveSendingDomainPatch(claim, outcome.patch)
    if (error.code === 'missing_scope' || error.code === 'unauthorized') {
      logger.error('Sending-domain provider rejected our credentials', { provider: provider.name, code: error.code })
      recordSupportMetric('support.sending_domain.provider_misconfigured', { provider: provider.name })
      throw providerMisconfiguredError()
    }
    if (error.code === 'rate_limited') {
      if (error.retryAfterSeconds) setResponseHeader(event, 'Retry-After', error.retryAfterSeconds)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too Many Requests',
        data: createErrorResponse(
          ErrorCode.RATE_LIMITED,
          'The mail provider is rate limiting requests. Try again shortly.'
        ),
      })
    }
    throw createError({
      statusCode: error.code === 'provider_unavailable' ? 503 : 502,
      statusMessage: error.code === 'provider_unavailable' ? 'Service Unavailable' : 'Bad Gateway',
      data: createErrorResponse('PROVIDER_UNAVAILABLE', 'The mail provider could not be reached. Try again shortly.'),
    })
  }

  const saved = await saveSendingDomainPatch(claim, outcome.patch)
  // Best effort and skipped when already done; the domain poll retries a failure.
  if (saved && outcome.patch.status === 'verified') await syncDeliveryWebhooks(claim, provider)
  // Receiving status, last message, MX record and the MX takeover lookup, as the poll does.
  // Never throws.
  if (saved) await syncDomainReceiving({ ...claim, ...outcome.patch } as SendingDomainRow, provider)
  if (outcome.transition === 'verified') {
    recordSupportMetric('support.sending_domain.verified', {
      domainId: claim.id,
      provider: provider.name,
      status: 'verified',
    })
  } else if (outcome.transition === 'suspended') {
    recordSupportMetric('support.sending_domain.suspended', {
      domainId: claim.id,
      provider: provider.name,
      status: 'suspended',
    })
  }
  return createSuccessResponse(toSendingDomainView(await reload(), provider))
}

async function respondToRegister(
  event: Parameters<typeof setResponseStatus>[0],
  claim: SendingDomainRow,
  outcome: Awaited<ReturnType<typeof registerSendingDomainClaim>>,
  reload: () => Promise<SendingDomainRow>
) {
  const provider = requireConfiguredSendingDomainProvider()

  if (outcome.kind === 'ok') {
    await saveSendingDomainPatch(claim, outcome.patch)
    return createSuccessResponse(toSendingDomainView(await reload(), provider))
  }

  if (outcome.kind === 'transient') {
    await saveSendingDomainPatch(claim, outcome.patch)
    setResponseStatus(event, 202)
    return createSuccessResponse(toSendingDomainView(await reload(), provider))
  }

  if (outcome.kind === 'misconfigured') {
    logger.error('Sending-domain provider rejected our credentials', { provider: provider.name, code: outcome.code })
    recordSupportMetric('support.sending_domain.provider_misconfigured', { provider: provider.name })
    throw providerMisconfiguredError()
  }

  // A permanent refusal on an existing claim: keep it visible as failed (no more
  // automatic attempts) so the admin sees why, and answer with the error.
  const now = new Date()
  const expiresAt = claim.expiresAt ?? pendingExpiryFrom(now)
  await saveSendingDomainPatch(claim, {
    status: 'failed',
    expiresAt,
    lastErrorCode: outcome.code,
    lastError: outcome.message,
    lastCheckedAt: now,
    nextCheckAt: expiresAt,
    leaseExpiresAt: null,
    updatedAt: now,
  })
  throw registerOutcomeToError(outcome)
}
