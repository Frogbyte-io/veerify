/**
 * @openapi
 * /api/user/api-keys:
 *   get:
 *     tags: [User]
 *     summary: List your personal API keys
 *     description: "Returns metadata for your own keys, including revoked and expired ones, newest first. The key secret and hash are never returned. Not available to API key principals."
 *     operationId: listUserApiKeys
 *     responses:
 *       200: { description: "Personal API key summaries" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Requires signing in directly (API keys cannot manage API keys)" }
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { userApiKey } from '~/server/database/schema/credentials'
import { requireInteractiveSession } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireInteractiveSession(event)

  const keys = await db
    .select({
      id: userApiKey.id,
      name: userApiKey.name,
      keyPrefix: userApiKey.keyPrefix,
      createdAt: userApiKey.createdAt,
      lastUsedAt: userApiKey.lastUsedAt,
      expiresAt: userApiKey.expiresAt,
      revokedAt: userApiKey.revokedAt,
    })
    .from(userApiKey)
    .where(eq(userApiKey.userId, session.user.id))
    .orderBy(desc(userApiKey.createdAt))

  return createSuccessResponse(keys)
})
