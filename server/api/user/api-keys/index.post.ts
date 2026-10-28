/**
 * @openapi
 * /api/user/api-keys:
 *   post:
 *     tags: [User]
 *     summary: Create a personal API key
 *     description: "The full key (vfy_usr_...) is returned once in this response and cannot be retrieved later. Maximum 25 active keys per user. Not available to API key principals."
 *     operationId: createUserApiKey
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 60 }
 *               expiresInDays: { type: integer, minimum: 1, maximum: 365, nullable: true, description: "Omit or null for a key that never expires" }
 *     responses:
 *       201: { description: "Key created; includes the full key once" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Requires signing in directly (API keys cannot manage API keys)" }
 *       409: { description: "Already 25 active keys" }
 */
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { userApiKey } from '~/server/database/schema/credentials'
import { requireInteractiveSession } from '~/server/utils/auth-middleware'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { MAX_ACTIVE_KEYS, countActiveUserApiKeys, generateUserApiKey } from '~/server/utils/user-api-keys'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireInteractiveSession(event)
  const body = await validateBody(event, createKeySchema)
  const now = new Date()

  if ((await countActiveUserApiKeys(session.user.id)) >= MAX_ACTIVE_KEYS) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, `You can have at most ${MAX_ACTIVE_KEYS} active API keys`),
    })
  }

  const { key, keyPrefix, keyHash } = generateUserApiKey()
  const expiresAt = body.expiresInDays ? new Date(now.getTime() + body.expiresInDays * 86400000) : null

  const [created] = await db
    .insert(userApiKey)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: body.name,
      keyPrefix,
      keyHash,
      createdAt: now,
      expiresAt,
    })
    .returning({
      id: userApiKey.id,
      name: userApiKey.name,
      keyPrefix: userApiKey.keyPrefix,
      createdAt: userApiKey.createdAt,
      lastUsedAt: userApiKey.lastUsedAt,
      expiresAt: userApiKey.expiresAt,
      revokedAt: userApiKey.revokedAt,
    })

  setResponseStatus(event, 201)
  return createSuccessResponse({ ...created, key })
})
