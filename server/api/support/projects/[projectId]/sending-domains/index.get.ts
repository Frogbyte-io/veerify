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
 *       `limits.maxDomains` and `limits.maxPending` are the workspace mail limits
 *       (shared by every project of the workspace), and `usage` is the workspace's
 *       mail tier, limits and current usage (domains, pending domains, custom
 *       addresses; `forwardsThisMonth` is null until forwarding ships). Each domain also carries
 *       `receivingStatus`, `lastReceivedAt` (when it last received a message) and
 *       `existingMxHosts` (mail hosts it already uses, other than the SES inbound host; the
 *       receiving MX would move all of its mail away from them). `missingEnvVars` is always
 *       empty: missing provider settings are logged on the server instead.
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
import { PENDING_TTL_DAYS } from '~/lib/support-sending-domains'
import type { SendingDomainListResponse } from '~/lib/support-sending-domains'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import {
  isSendingDomainsEnabled,
  listProjectSendingDomains,
  resolveSenderPolicy,
  toSendingDomainView,
} from '~/server/utils/sending-domains'
import { requireSendingDomainReader } from '~/server/utils/sending-domain-api'
import { getMailUsage, getOrganizationIdForProject } from '~/server/utils/mail-limits'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('sending-domains')
let loggedMissingSettings = ''

/** Once per process and set of names, so a polling page does not flood the log. */
function logMissingProviderSettings(missing: string[]) {
  const key = missing.join(',')
  if (key === loggedMissingSettings) return
  loggedMissingSettings = key
  logger.warn('Sending domains are enabled but the mail provider is not configured', { missing })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const access = await requireSendingDomainReader(projectId, session.user.id)

  // Limits count per workspace, across all of its projects.
  const usage = await getMailUsage(await getOrganizationIdForProject(projectId))
  const limits = {
    maxDomains: usage.limits.domains,
    maxPending: usage.limits.pendingDomains,
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
      usage,
      providerConfigured: false,
      missingEnvVars: [],
      domains: [],
    }
    return createSuccessResponse(disabled)
  }

  const provider = getSendingDomainProvider()
  const configured = provider?.isConfigured() ?? { configured: false, missing: [] as string[] }
  // Setting names are for the operator (server log), not for customers.
  if (!configured.configured) logMissingProviderSettings(configured.missing)
  const rows = await listProjectSendingDomains(projectId)

  const data: SendingDomainListResponse = {
    enabled: true,
    policy,
    provider: provider?.name ?? null,
    capabilities: provider?.capabilities ?? null,
    canManage: access.isProjectAdmin,
    limits,
    usage,
    providerConfigured: configured.configured,
    missingEnvVars: [],
    domains: rows.map((row) => toSendingDomainView(row, provider ?? undefined)),
  }
  return createSuccessResponse(data)
})
