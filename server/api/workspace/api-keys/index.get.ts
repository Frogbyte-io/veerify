/**
 * @openapi
 * /api/workspace/api-keys:
 *   get:
 *     tags: [Marketing]
 *     summary: List the workspace's marketing API keys
 *     description: >
 *       Any workspace member can list. Only key hints and validation status are
 *       returned, never the keys. `secretsConfigured` is false when the server
 *       has no SECRETS_ENCRYPTION_KEY and keys cannot be stored.
 *     operationId: listMarketingCredentials
 *     responses:
 *       200: { description: Credentials, canManage and secretsConfigured }
 *       403: { description: Not a member of this workspace }
 */
import { isOrganizationAdminRole } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { listOrgCredentials } from '~/server/utils/org-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { requireCredentialMember } from '~/server/utils/marketing-credential-routes'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const role = await requireCredentialMember(organizationId, session.user.id)

  const credentials = await listOrgCredentials(organizationId)
  return createSuccessResponse({
    credentials,
    canManage: isOrganizationAdminRole(role),
    secretsConfigured: isSecretsConfigured(),
  })
})
