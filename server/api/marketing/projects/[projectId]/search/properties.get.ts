/**
 * @openapi
 * /api/marketing/projects/{projectId}/search/properties:
 *   get:
 *     tags: [Marketing]
 *     summary: List the Search Console properties the connected Google account can read
 *     description: Team admins only. Properties where the account is only an unverified user are left out.
 *     operationId: listSearchProperties
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "`{ properties: [{ siteUrl, permissionLevel }], selected }`" }
 *       403: { description: Team admin required, or Marketing is off }
 *       404: { description: Search Console is not connected }
 *       409: { description: Google access was revoked; reconnect }
 *       502: { description: Google request failed }
 *       503: { description: Search Console is not configured on this server }
 */
import { listSites } from '~/server/services/google/search-console'
import {
  getAccessTokenFor,
  requireGscConfig,
  requireGscConnection,
  toGoogleHttpError,
} from '~/server/services/marketing/search/connection'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)

  const site = await findMarketingSite(projectId)
  if (!site) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No marketing site is set up for this product'),
    })
  }
  const config = requireGscConfig()
  const conn = await requireGscConnection(site.id)

  try {
    const accessToken = await getAccessTokenFor(conn, config)
    const sites = await listSites(accessToken)
    return createSuccessResponse({
      properties: sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser'),
      selected: conn.propertyUrl,
    })
  } catch (error) {
    return toGoogleHttpError(site.id, error)
  }
})
