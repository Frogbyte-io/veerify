/**
 * @openapi
 * /api/marketing/projects/{projectId}/search/connect:
 *   get:
 *     tags: [Marketing]
 *     summary: Start the Google Search Console connection
 *     description: >
 *       Team admins only. Returns the Google consent URL, carrying a signed state that binds the
 *       flow to this site and user. The site must be verified. Returns 503 when the server has no
 *       Google OAuth app or no secrets encryption key.
 *     operationId: getSearchConnectUrl
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "`{ url }` to send the browser to" }
 *       403: { description: Team admin required, or Marketing is off }
 *       409: { description: The site is not set up or not verified }
 *       503: { description: Search Console is not configured on this server }
 */
import { buildAuthorizationUrl } from '~/server/services/google/search-console'
import { signOAuthState } from '~/server/services/google/oauth-state'
import { requireGscConfig } from '~/server/services/marketing/search/connection'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)

  const site = await findMarketingSite(projectId)
  if (!site || !site.verifiedAt) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'Verify your site before connecting Search Console'),
    })
  }

  const config = requireGscConfig()
  const state = signOAuthState({ siteId: site.id, userId: session.user.id, projectId })
  return createSuccessResponse({ url: buildAuthorizationUrl(config, state) })
})
