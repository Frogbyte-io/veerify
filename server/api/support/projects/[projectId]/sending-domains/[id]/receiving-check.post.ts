/**
 * @openapi
 * /api/support/projects/{projectId}/sending-domains/{id}/receiving-check:
 *   post:
 *     tags: [Support]
 *     summary: Refresh a domain's receiving status now
 *     description: >
 *       Project administrators only. Asks the mail provider for the domain's receiving status
 *       and stores it: `receivingStatus`, `lastReceivedAt` (when the domain last received a
 *       message), the receiving MX record and, while receiving is not active, the domain's
 *       existing MX hosts (`existingMxHosts`). Cheaper than a full verify: no DKIM or ownership
 *       re-check. The Email tab calls it while it waits for a test email. Returns the updated
 *       domain in the same shape as the list.
 *     operationId: checkSupportSendingDomainReceiving
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
 *       200: { description: "Updated sending domain (SendingDomainView with receivingStatus, lastReceivedAt, existingMxHosts)" }
 *       403: { description: Project administrator required }
 *       404: { description: Feature disabled, or the domain does not belong to this project }
 *       409: { description: "Domain is being removed (CONFLICT), or this deployment does not receive mail (RECEIVING_UNAVAILABLE)" }
 *       429: { description: Rate limit exceeded }
 *       503: { description: Provider not configured }
 */
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { getProjectSendingDomain, toSendingDomainView } from '~/server/utils/sending-domains'
import { syncDomainReceiving } from '~/server/utils/sending-domain-poller'
import { requireConfiguredSendingDomainProvider, requireSendingDomainsEnabled } from '~/server/utils/sending-domain-api'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const id = getRouterParam(event, 'id') as string
  await requireProjectAdmin(projectId, session.user.id)
  requireSendingDomainsEnabled()

  const claim = await getProjectSendingDomain(projectId, id)

  await requireRateLimit(event, {
    maxRequests: 1,
    windowSeconds: 10,
    identifier: 'sending-domain-receiving-check',
    subject: `domain:${claim.id}`,
  })
  await requireRateLimit(event, {
    maxRequests: 240,
    windowSeconds: 60 * 60,
    identifier: 'sending-domain-receiving-check-project',
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
  if (!provider.capabilities.forwarding) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse('RECEIVING_UNAVAILABLE', 'This deployment does not receive mail for your domains.'),
    })
  }

  // Never throws; a provider failure leaves the stored state as it was.
  await syncDomainReceiving(claim, provider)
  return createSuccessResponse(toSendingDomainView(await getProjectSendingDomain(projectId, claim.id), provider))
})
