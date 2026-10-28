/**
 * @openapi
 * /api/device/code:
 *   post:
 *     tags: [Device login]
 *     summary: Start a device login (RFC 8628)
 *     description: "Public. An agent requests a device code and a short user code, then sends the user to verification_uri_complete to approve it. Rate limited to 10 requests per 60 s per IP. The response is a bare RFC 8628 object, not the usual envelope."
 *     operationId: requestDeviceCode
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               client_name: { type: string, maxLength: 60, description: "Shown to the user on the approval page and used as the key name. Control and format characters are removed" }
 *     responses:
 *       200:
 *         description: "Device authorization response"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device_code: { type: string }
 *                 user_code: { type: string, example: "BCDF-GHJK" }
 *                 verification_uri: { type: string }
 *                 verification_uri_complete: { type: string }
 *                 expires_in: { type: integer, example: 600 }
 *                 interval: { type: integer, example: 5 }
 *       400: { description: "invalid_request (RFC 8628 error body)" }
 *       429: { description: "Rate limit exceeded" }
 */
import { z } from 'zod'
import { createDeviceAuthorization } from '~/server/services/device-login'
import { deviceBodyTooLarge, getPublicBaseUrl } from '~/server/utils/device-http'
import { requireRateLimit } from '~/server/utils/rate-limit'

/** Control, format and bidi characters are dropped so a client cannot spoof or hide text on the approval page. */
const bodySchema = z.object({
  client_name: z
    .string()
    .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
    .pipe(z.string().max(60))
    .optional(),
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { maxRequests: 10, windowSeconds: 60, identifier: 'device-code' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')

  if (deviceBodyTooLarge(event)) {
    setResponseStatus(event, 400)
    return { error: 'invalid_request', error_description: 'Request body too large' }
  }

  const parsed = bodySchema.safeParse((await readBody(event).catch(() => undefined)) ?? {})
  if (!parsed.success) {
    setResponseStatus(event, 400)
    return { error: 'invalid_request', error_description: 'client_name must be a string of at most 60 characters' }
  }

  const created = await createDeviceAuthorization({ clientName: parsed.data.client_name })
  const verificationUri = `${getPublicBaseUrl()}/device`
  return {
    device_code: created.deviceCode,
    user_code: created.userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${created.userCode}`,
    expires_in: created.expiresIn,
    interval: created.interval,
  }
})
