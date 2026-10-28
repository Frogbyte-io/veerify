/**
 * @openapi
 * /api/device/requests/{userCode}/approve:
 *   post:
 *     tags: [Device login]
 *     summary: Approve a device login
 *     description: "Browser session only (API keys get 403). Rate limited to 10 requests per 60 s per user. Unknown, expired and already decided codes all return the same 404."
 *     operationId: approveDeviceRequest
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { name: userCode, in: path, required: true, schema: { type: string }, example: "BCDF-GHJK" }
 *     responses:
 *       200: { description: "Approved; data.status is approved" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Browser session only" }
 *       404: { description: "Code not found or expired" }
 *       409: { description: "Already 25 active API keys" }
 *       429: { description: "Rate limit exceeded" }
 */
import { approveDeviceAuthorization } from '~/server/services/device-login'
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

  await approveDeviceAuthorization(getRouterParam(event, 'userCode') ?? '', session.user.id)
  return { data: { status: 'approved' } }
})
