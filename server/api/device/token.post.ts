/**
 * @openapi
 * /api/device/token:
 *   post:
 *     tags: [Device login]
 *     summary: Poll for the device login token (RFC 8628)
 *     description: "Public. Poll no faster than the interval. Accepts JSON or application/x-www-form-urlencoded. Errors are RFC 8628 bodies with HTTP 400: authorization_pending, slow_down, access_denied, expired_token, invalid_grant, invalid_request. The issued key is a personal API key valid for 90 days. Rate limited to 600 requests per 60 s per IP; over the limit the response is the RFC error slow_down (HTTP 400)."
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
 *  */
import { z } from 'zod'
import { pollDeviceToken } from '~/server/services/device-login'
import { deviceBodyTooLarge } from '~/server/utils/device-http'
import { checkRateLimit } from '~/server/utils/rate-limit'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

const bodySchema = z.object({
  device_code: z.string().min(1),
  grant_type: z.literal(DEVICE_GRANT).optional(),
})

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')

  // RFC 8628 clients treat a non-RFC 429 as fatal, so a rejected limit is the retryable slow_down error.
  if (!(await checkRateLimit(event, { maxRequests: 600, windowSeconds: 60, identifier: 'device-token' }))) {
    setResponseStatus(event, 400)
    return { error: 'slow_down', error_description: 'Too many requests; slow down' }
  }

  if (deviceBodyTooLarge(event)) {
    setResponseStatus(event, 400)
    return { error: 'invalid_request', error_description: 'Request body too large' }
  }

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
