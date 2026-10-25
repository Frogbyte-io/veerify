/**
 * @openapi
 * /api/workspace/spend:
 *   get:
 *     tags: [Marketing]
 *     summary: This month's AI spend for the workspace
 *     description: >
 *       Any workspace member can read. Spend is Veerify's own estimate from token and search usage
 *       at list prices (the provider invoice stays the source of truth). `inFlightUsdMicros` is
 *       reserved for calls still running. Caps are in cents; null means uncapped.
 *     operationId: getWorkspaceSpend
 *     responses:
 *       200: { description: "`{ period, totalUsdMicros, inFlightUsdMicros, workspaceCapCents, providers, canManage }`" }
 *       403: { description: Not a member of this workspace }
 */
import { isOrganizationAdminRole } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { LLM_CREDENTIAL_PROVIDERS, listOrgCredentials } from '~/server/utils/org-credentials'
import { requireCredentialMember } from '~/server/utils/marketing-credential-routes'
import { currentPeriod, getUsage } from '~/server/utils/marketing-usage'
import {
  WORKSPACE_BUDGET_SCOPE,
  costMetric,
  getWorkspaceSpendCapCents,
  reservedMetric,
} from '~/server/services/marketing/llm-budget'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const role = await requireCredentialMember(organizationId, session.user.id)

  const [usage, credentials, workspaceCapCents] = await Promise.all([
    getUsage(organizationId),
    listOrgCredentials(organizationId),
    getWorkspaceSpendCapCents(organizationId),
  ])
  const capByProvider = new Map(credentials.map((c) => [c.provider, c.monthlyBudgetCents ?? null]))

  const providers = LLM_CREDENTIAL_PROVIDERS.map((provider) => ({
    provider,
    spentUsdMicros: usage[costMetric(provider)] ?? 0,
    inFlightUsdMicros: usage[reservedMetric(provider)] ?? 0,
    capCents: capByProvider.get(provider) ?? null,
    hasKey: capByProvider.has(provider),
  }))

  return createSuccessResponse({
    period: currentPeriod(),
    totalUsdMicros: providers.reduce((sum, p) => sum + p.spentUsdMicros, 0),
    inFlightUsdMicros: usage[reservedMetric(WORKSPACE_BUDGET_SCOPE)] ?? 0,
    workspaceCapCents,
    providers,
    canManage: isOrganizationAdminRole(role),
  })
})
