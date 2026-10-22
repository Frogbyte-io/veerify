/**
 * @openapi
 * /api/support/teams/{teamId}/sending-domains/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Release a sending domain
 *     description: >
 *       Team administrators only. Marks the claim as removing (it stops authorizing at
 *       once), removes the provider domain when Veerify created it, then deletes the
 *       claim. Adopted domains are never deleted at the provider. When inboxes still
 *       send from the domain the request is refused unless `force=true`.
 *     operationId: deleteSupportSendingDomain
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: force
 *         required: false
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Domain released }
 *       202: { description: Removal at the provider failed temporarily and will be retried }
 *       400: { description: Invalid query }
 *       403: { description: Team administrator required }
 *       404: { description: Feature disabled, or the domain does not belong to this team }
 *       409: { description: Inboxes still use this domain and force was not set }
 *       429: { description: Rate limit exceeded }
 */
import { and, eq } from 'drizzle-orm'
import { createError, setResponseStatus } from 'h3'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { supportSendingDomain } from '~/server/database/schema/support'
import { createErrorResponse, createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { validateQuery } from '~/server/utils/validation'
import { createLogger } from '~/server/utils/logger'
import { recordSupportMetric } from '~/server/utils/support-observability'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { getTeamSendingDomain, listTeamSendingDomains } from '~/server/utils/sending-domains'
import {
  deleteSendingDomainRow,
  removeSendingDomainClaim,
  saveSendingDomainPatch,
} from '~/server/utils/sending-domain-poller'
import { listInboxesUsingDomain, requireSendingDomainsEnabled } from '~/server/utils/sending-domain-api'

const logger = createLogger('sending-domains')

const querySchema = z.object({
  force: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => value === 'true' || value === '1'),
})

const OPERATOR_CLEANUP_MESSAGE =
  'Veerify released this domain. Your operator must remove it from the mail provider because it receives mail there.'

const INLINE_REMOVE_LEASE_MS = 2 * 60 * 1000

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const id = getRouterParam(event, 'id') as string
  await requireTeamAdmin(teamId, session.user.id)
  requireSendingDomainsEnabled()
  const { force } = validateQuery(event, querySchema)

  const claim = await getTeamSendingDomain(teamId, id)

  await requireRateLimit(event, {
    maxRequests: 20,
    windowSeconds: 60 * 60,
    identifier: 'sending-domain-delete',
    subject: `team:${teamId}`,
  })

  const provider = getSendingDomainProvider()

  if (!force && claim.status !== 'deleting') {
    const siblings = (await listTeamSendingDomains(teamId)).filter((other) => other.id !== claim.id)
    const inboxes = await listInboxesUsingDomain(
      claim,
      provider,
      siblings.map((other) => other.domain)
    )
    if (inboxes.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(
          'DOMAIN_IN_USE',
          'Inboxes still send from this domain. Deleting it blocks their replies.',
          { inboxes }
        ),
      })
    }
  }

  // Step 1 (design §8.4): from here the claim no longer authorizes anything. The
  // short lease keeps the poller from racing the inline removal below.
  const now = new Date()
  const [marked] = await db
    .update(supportSendingDomain)
    .set({
      status: 'deleting',
      leaseExpiresAt: new Date(now.getTime() + INLINE_REMOVE_LEASE_MS),
      nextCheckAt: new Date(now.getTime() + INLINE_REMOVE_LEASE_MS),
      updatedAt: now,
    })
    .where(and(eq(supportSendingDomain.id, claim.id), eq(supportSendingDomain.teamId, teamId)))
    .returning()
  if (!marked) {
    // Another request deleted it between the lookup and now.
    return createSuccessResponse({ deleted: true, operatorCleanupRequired: false })
  }

  const outcome = await removeSendingDomainClaim(marked, provider, { now })

  if (outcome.kind === 'deleted') {
    await deleteSendingDomainRow(marked)
    recordSupportMetric('support.sending_domain.deleted', {
      domainId: marked.id,
      provider: marked.provider,
      status: claim.status,
    })
    if (outcome.operatorCleanupRequired) {
      recordSupportMetric('support.sending_domain.operator_cleanup_required', {
        domainId: marked.id,
        provider: marked.provider,
        status: claim.status,
      })
      return createSuccessResponse({ deleted: true, operatorCleanupRequired: true }, OPERATOR_CLEANUP_MESSAGE)
    }
    return createSuccessResponse({ deleted: true, operatorCleanupRequired: false })
  }

  // Transient (or credential) failure at the provider: the row stays `deleting`
  // and the poller retries.
  if (outcome.kind === 'misconfigured') {
    logger.error('Sending-domain provider rejected our credentials during delete', { domainId: marked.id })
    recordSupportMetric('support.sending_domain.provider_misconfigured', { provider: marked.provider })
  }
  await saveSendingDomainPatch(marked, outcome.patch)
  setResponseStatus(event, 202)
  return createSuccessResponse(
    { deleted: false, status: 'deleting', operatorCleanupRequired: false },
    'Removal is in progress and will be retried automatically.'
  )
})
