/**
 * @openapi
 * /api/device/requests/{userCode}:
 *   get:
 *     tags: [Device login]
 *     summary: Look up a pending device login by its user code
 *     description: "Browser session only (API keys get 403). Rate limited to 10 requests per 60 s per user. Unknown, expired and already decided codes all return the same 404."
 *     operationId: getDeviceRequest
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { name: userCode, in: path, required: true, schema: { type: string }, example: "BCDF-GHJK" }
 *     responses:
 *       200: { description: "The pending request: userCode, clientName, expiresAt" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Browser session only" }
 *       404: { description: "Code not found or expired" }
 *       429: { description: "Rate limit exceeded" }
 */
import { findPendingByUserCode, formatUserCode, normalizeUserCode, notFound } from '~/server/services/device-login'
import { requireInteractiveSession } from '~/server/utils/auth-middleware'
import { requireRateLimit } from '~/server/utils/rate-limit'

export default defineEventHandler(async (event) => {
  const session = await requireInteractiveSession(event)
  await requireRateLimit(event, {
    maxRequests: 10,
    windowSeconds: 60,
    identifier: 'device-approve',
    subject: session.user.id,
  })

  const userCode = getRouterParam(event, 'userCode') ?? ''
  const pending = await findPendingByUserCode(userCode)
  if (!pending) notFound()
  return {
    data: {
      userCode: formatUserCode(normalizeUserCode(userCode)),
      clientName: pending.clientName,
      expiresAt: pending.expiresAt,
    },
  }
})
