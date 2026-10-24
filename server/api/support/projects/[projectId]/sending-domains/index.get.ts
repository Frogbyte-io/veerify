/**
 * @openapi
 * /api/support/projects/{projectId}/sending-domains:
 *   get:
 *     tags: [Support]
 *     summary: List the project's customer sending domains
 *     description: >
 *       Returns the project's domain claims with their DNS records, plus the provider
 *       capabilities, limits and whether the caller may manage domains. When the
 *       feature is disabled the response is `{ enabled: false }` with an empty list.
 *     operationId: listSupportSendingDomains
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sending domains and provider status }
 *       401: { description: Authentication required }
 *       403: { description: No support access to this project }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { MAX_DOMAINS_PER_PROJECT, MAX_PENDING_PER_PROJECT, PENDING_TTL_DAYS } from '~/lib/support-sending-domains'
import type { SendingDomainListResponse } from '~/lib/support-sending-domains'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import {
  isSendingDomainsEnabled,
  listProjectSendingDomains,
  resolveSenderPolicy,
  toSendingDomainView,
} from '~/server/utils/sending-domains'
import { requireSendingDomainReader } from '~/server/utils/sending-domain-api'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const access = await requireSendingDomainReader(projectId, session.user.id)

  const limits = {
    maxDomains: MAX_DOMAINS_PER_PROJECT,
    maxPending: MAX_PENDING_PER_PROJECT,
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
  const rows = await listProjectSendingDomains(projectId)

  const data: SendingDomainListResponse = {
    enabled: true,
    policy,
    provider: provider?.name ?? null,
    capabilities: provider?.capabilities ?? null,
    canManage: access.isProjectAdmin,
    limits,
    providerConfigured: configured.configured,
    missingEnvVars: configured.missing,
    domains: rows.map((row) => toSendingDomainView(row, provider ?? undefined)),
  }
  return createSuccessResponse(data)
})
