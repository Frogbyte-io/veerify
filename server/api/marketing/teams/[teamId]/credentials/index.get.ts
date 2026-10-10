/**
 * @openapi
 * /api/marketing/teams/{teamId}/credentials:
 *   get:
 *     tags: [Marketing]
 *     summary: List the team's marketing API keys
 *     description: >
 *       Any team member can list. Only key hints and validation status are
 *       returned, never the keys. `secretsConfigured` is false when the server
 *       has no SECRETS_ENCRYPTION_KEY and keys cannot be stored.
 *     operationId: listMarketingCredentials
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Credentials, canManage and secretsConfigured }
 *       403: { description: Not a member of this team }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createSuccessResponse } from '~/server/utils/response'
import { listTeamCredentials } from '~/server/utils/team-credentials'
import { isSecretsConfigured } from '~/server/utils/secrets'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireCredentialMember } from '~/server/utils/marketing-credential-routes'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const membership = await requireCredentialMember(teamId, session.user.id)

  const credentials = await listTeamCredentials(teamId)
  return createSuccessResponse({
    credentials,
    canManage: membership.role === 'admin',
    secretsConfigured: isSecretsConfigured(),
  })
})
