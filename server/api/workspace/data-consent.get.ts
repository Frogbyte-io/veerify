/**
 * @openapi
 * /api/workspace/data-consent:
 *   get:
 *     tags: [Marketing]
 *     summary: Whether feedback and support text may be sent to the workspace's AI provider
 *     description: Both sources are off until a workspace owner or admin turns them on.
 *     operationId: getMarketingDataConsent
 *     responses:
 *       200: { description: Consent flags, who consented and when, and canManage }
 *       403: { description: Not a member of this workspace }
 */
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { isOrganizationAdminRole } from '~/server/utils/project-access'
import { createSuccessResponse } from '~/server/utils/response'
import { getConsentSummary, requireConsentMember } from '~/server/services/marketing/customer-language/consent'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const role = await requireConsentMember(organizationId, session.user.id)

  return createSuccessResponse({
    ...(await getConsentSummary(organizationId)),
    canManage: isOrganizationAdminRole(role),
  })
})
