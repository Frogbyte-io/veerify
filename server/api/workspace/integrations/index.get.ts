/**
 * @openapi
 * /api/workspace/integrations:
 *   get:
 *     tags: [Marketing]
 *     summary: Status of the workspace's Marketing integrations
 *     description: >
 *       Any workspace member can read. Shows, per integration, whether it works, what is
 *       missing and what to set. Never returns keys.
 *     operationId: listMarketingIntegrations
 *     responses:
 *       200: { description: Integration statuses and canManage }
 *       403: { description: Not a member of this workspace }
 */
import { isOrganizationAdminRole } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { requireCredentialMember } from '~/server/utils/marketing-credential-routes'
import { getIntegrationStatus } from '~/server/utils/marketing-integrations'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const role = await requireCredentialMember(organizationId, session.user.id)

  const integrations = await getIntegrationStatus(organizationId)
  return createSuccessResponse({ integrations, canManage: isOrganizationAdminRole(role) })
})
