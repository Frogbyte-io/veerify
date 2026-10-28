/**
 * @openapi
 * /api/device/token:
 *   post:
 *     tags: [Device login]
 *     summary: Poll for the device login token (RFC 8628)
 *     description: "Public. Poll no faster than the interval. Accepts JSON or application/x-www-form-urlencoded. Errors are RFC 8628 bodies with HTTP 400: authorization_pending, slow_down, access_denied, expired_token, invalid_grant, invalid_request. The issued key is a personal API key valid for 90 days. Rate limited to 60 requests per 60 s per IP."
 *     operationId: pollDeviceToken
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_code]
 *             properties:
 *               device_code: { type: string }
 *               grant_type: { type: string, enum: ["urn:ietf:params:oauth:grant-type:device_code"] }
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [device_code]
 *             properties:
 *               device_code: { type: string }
 *               grant_type: { type: string, enum: ["urn:ietf:params:oauth:grant-type:device_code"] }
 *     responses:
 *       200:
 *         description: "Approved; the key is returned once"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token: { type: string }
 *                 token_type: { type: string, example: Bearer }
 *                 expires_in: { type: integer, example: 7776000 }
 *       400: { description: "RFC 8628 error body: { error, error_description }" }
 *       429: { description: "Rate limit exceeded" }
 */
import { z } from 'zod'
import { pollDeviceToken } from '~/server/services/device-login'
import { requireRateLimit } from '~/server/utils/rate-limit'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

const bodySchema = z.object({
  device_code: z.string().min(1),
  grant_type: z.literal(DEVICE_GRANT).optional(),
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { maxRequests: 60, windowSeconds: 60, identifier: 'device-token' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')

  // readBody parses JSON and form-urlencoded bodies according to the content-type.
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => undefined))
  if (!parsed.success) {
    setResponseStatus(event, 400)
    return {
      error: 'invalid_request',
      error_description: `device_code is required and grant_type, when present, must be ${DEVICE_GRANT}`,
    }
  }

  const result = await pollDeviceToken(parsed.data.device_code)
  if (!result.ok) {
    setResponseStatus(event, 400)
    return { error: result.error, error_description: result.description }
  }
  setResponseStatus(event, 200)
  return { access_token: result.accessToken, token_type: 'Bearer', expires_in: result.expiresIn }
})
