/**
 * @openapi
 * /api/marketing/projects/{projectId}/search/connection:
 *   delete:
 *     tags: [Marketing]
 *     summary: Disconnect Google Search Console
 *     description: >
 *       Project admins only. Revokes the Google token (best effort) and deletes the connection and
 *       its stored metrics.
 *     operationId: deleteSearchConnection
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Disconnected }
 *       403: { description: Project admin required, or Marketing is off }
 *       404: { description: Search Console is not connected }
 */
import { revokeToken } from '~/server/services/google/search-console'
import { gscAad, removeGscConnection, requireGscConnection } from '~/server/services/marketing/search/connection'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { decryptSecret } from '~/server/utils/secrets'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
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
  const conn = await requireGscConnection(site.id)

  try {
    await revokeToken(decryptSecret(conn.encryptedRefreshToken, gscAad(site.id)))
  } catch {
    // Best effort: an undecryptable or already revoked token must not block disconnecting.
  }

  await removeGscConnection(site.id)
  return createSuccessResponse({ disconnected: true })
})
