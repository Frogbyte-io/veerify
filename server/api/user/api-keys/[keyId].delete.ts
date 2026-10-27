/**
 * @openapi
 * /api/user/api-keys/{keyId}:
 *   delete:
 *     tags: [User]
 *     summary: Revoke a personal API key
 *     description: "Revoked keys are rejected immediately and the row is kept for audit. Not available to API key principals."
 *     operationId: revokeUserApiKey
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Key revoked" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Requires signing in directly (API keys cannot manage API keys)" }
 *       404: { description: "Key not found, not yours, or already revoked" }
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { userApiKey } from '~/server/database/schema/credentials'
import { requireInteractiveSession } from '~/server/utils/auth-middleware'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireInteractiveSession(event)
  const keyId = getRouterParam(event, 'keyId')

  if (!keyId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Key ID is required'),
    })
  }

  const [revoked] = await db
    .update(userApiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(userApiKey.id, keyId), eq(userApiKey.userId, session.user.id), isNull(userApiKey.revokedAt)))
    .returning({ id: userApiKey.id, revokedAt: userApiKey.revokedAt })

  if (!revoked) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'API key not found'),
    })
  }

  return createSuccessResponse(revoked)
})
