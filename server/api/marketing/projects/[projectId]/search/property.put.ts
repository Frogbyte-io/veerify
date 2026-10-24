/**
 * @openapi
 * /api/marketing/projects/{projectId}/search/property:
 *   put:
 *     tags: [Marketing]
 *     summary: Choose the Search Console property to read
 *     description: >
 *       Project admins only. The property must be one the connected Google account can read and must match the site
 *       (its URL-prefix property, or the sc-domain property for its registrable domain). Changing
 *       the property clears stored metrics and queues a fresh sync.
 *     operationId: putSearchProperty
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyUrl]
 *             properties:
 *               propertyUrl: { type: string, example: "sc-domain:example.com" }
 *     responses:
 *       200: { description: Property saved; status is now connected }
 *       400: { description: Not one of the account's properties }
 *       403: { description: Project admin required, or Marketing is off }
 *       404: { description: Search Console is not connected }
 *       409: { description: Google access was revoked; reconnect }
 *       502: { description: Google request failed }
 *       503: { description: Search Console is not configured on this server }
 */
import { z } from 'zod'
import { isPropertySelectableForOrigin, listSites } from '~/server/services/google/search-console'
import {
  getAccessTokenFor,
  requireGscConfig,
  requireGscConnection,
  setGscProperty,
  toGoogleHttpError,
} from '~/server/services/marketing/search/connection'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { findMarketingSite, requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ propertyUrl: z.string().trim().min(1).max(500) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

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

  let allowed: string[]
  try {
    const accessToken = await getAccessTokenFor(conn, config)
    allowed = (await listSites(accessToken))
      .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
      .map((s) => s.siteUrl)
  } catch (error) {
    return toGoogleHttpError(site.id, error)
  }

  if (!isPropertySelectableForOrigin(site.origin, body.propertyUrl)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `That property does not match this product's site. Choose the property for ${new URL(site.origin).host}`
      ),
    })
  }

  if (!allowed.includes(body.propertyUrl)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        'That property is not available to the connected Google account'
      ),
    })
  }

  // Drops the old property's metrics in the same transaction, serialised with a running sync
  await setGscProperty(site.id, body.propertyUrl)

  return createSuccessResponse({ propertyUrl: body.propertyUrl, status: 'connected' as const })
})
