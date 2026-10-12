/**
 * @openapi
 * /api/marketing/teams/{teamId}/credentials/{provider}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Remove a team API key
 *     description: Team admins only.
 *     operationId: deleteMarketingCredential
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [anthropic, openai, firecrawl, pagespeed] }
 *     responses:
 *       200: { description: Key removed }
 *       403: { description: Team admin required }
 *       404: { description: No key stored for this provider }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { deleteTeamCredential } from '~/server/utils/team-credentials'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireCredentialProvider, requireCredentialAdmin } from '~/server/utils/marketing-credential-routes'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const provider = requireCredentialProvider(event)
  await requireCredentialAdmin(teamId, session.user.id)

  const deleted = await deleteTeamCredential(teamId, provider)
  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No key stored for this provider'),
    })
  }

  return createSuccessResponse({ provider })
})
