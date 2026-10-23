/**
 * @openapi
 * /api/support/teams/{teamId}/sending-domains:
 *   get:
 *     tags: [Support]
 *     summary: List the team's customer sending domains
 *     description: >
 *       Returns the team's domain claims with their DNS records, plus the provider
 *       capabilities, limits and whether the caller may manage domains. When the
 *       feature is disabled the response is `{ enabled: false }` with an empty list.
 *     operationId: listSupportSendingDomains
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sending domains and provider status }
 *       401: { description: Authentication required }
 *       403: { description: No support access to this team }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { MAX_DOMAINS_PER_TEAM, MAX_PENDING_PER_TEAM, PENDING_TTL_DAYS } from '~/lib/support-sending-domains'
import type { SendingDomainListResponse } from '~/lib/support-sending-domains'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import {
  isSendingDomainsEnabled,
  listTeamSendingDomains,
  resolveSenderPolicy,
  toSendingDomainView,
} from '~/server/utils/sending-domains'
import { requireSendingDomainReader } from '~/server/utils/sending-domain-api'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const access = await requireSendingDomainReader(teamId, session.user.id)

  const limits = {
    maxDomains: MAX_DOMAINS_PER_TEAM,
    maxPending: MAX_PENDING_PER_TEAM,
    pendingTtlDays: PENDING_TTL_DAYS,
  }
  const policy = resolveSenderPolicy()

  if (!isSendingDomainsEnabled()) {
    const disabled: SendingDomainListResponse = {
      enabled: false,
      policy,
      provider: null,
      capabilities: null,
      canManage: false,
      limits,
      providerConfigured: false,
      missingEnvVars: [],
      domains: [],
    }
    return createSuccessResponse(disabled)
  }

  const provider = getSendingDomainProvider()
  const configured = provider?.isConfigured() ?? { configured: false, missing: [] as string[] }
  const rows = await listTeamSendingDomains(teamId)

  const data: SendingDomainListResponse = {
    enabled: true,
    policy,
    provider: provider?.name ?? null,
    capabilities: provider?.capabilities ?? null,
    canManage: access.isTeamAdmin,
    limits,
    providerConfigured: configured.configured,
    missingEnvVars: configured.missing,
    domains: rows.map((row) => toSendingDomainView(row, provider ?? undefined)),
  }
  return createSuccessResponse(data)
})
