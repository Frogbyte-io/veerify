/**
 * @openapi
 * /api/user/profile:
 *   put:
 *     tags: [User]
 *     summary: Update my profile
 *     description: >
 *       Updates the caller's name and email. Both fields are required. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       A personal API key may change the name but not the email: sending a different email returns 403 and requires signing in to Veerify directly. Send the current email unchanged to rename.
 *     operationId: updateUserProfile
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name: { type: string, minLength: 1 }
 *               email: { type: string, format: email, description: "Must equal the current email when using an API key" }
 *     responses:
 *       200: { description: "{ success: true, user }" }
 *       400: { description: "Missing fields, invalid email, or email already taken" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Email change attempted with a personal API key" }
 *       500: { description: "Internal server error" }
 */
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'
import { isCredentialPrincipal, requireAuth } from '~/server/utils/auth-middleware'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('user')

export default defineEventHandler(async (event) => {
  try {
    // Verify user is authenticated
    const session = await requireAuth(event)

    const body = await readBody(event)
    const { name, email } = body

    // Validate input
    if (!name || !email) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Name and email are required',
      })
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid email format',
      })
    }

    // A personal API key may not change the account email.
    if (
      isCredentialPrincipal(session) &&
      String(email).trim().toLowerCase() !== String(session.user.email).trim().toLowerCase()
    ) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Changing the account email requires signing in to Veerify directly',
      })
    }

    // Check if email is already taken by another user
    const existingUser = await db.select().from(user).where(eq(user.email, email)).limit(1)

    if (existingUser.length > 0 && existingUser[0].id !== session.user.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Email is already taken',
      })
    }

    // Update user profile
    const updatedUser = await db
      .update(user)
      .set({
        name: name.trim(),
        // Credential principals never rewrite the stored email (not even its casing).
        email: isCredentialPrincipal(session) ? session.user.email : email.trim(),
        updatedAt: new Date(),
      })
      .where(eq(user.id, session.user.id))
      .returning()

    return {
      success: true,
      user: updatedUser[0],
    }
  } catch (error) {
    logger.error('Profile update failed', { error: error instanceof Error ? error.message : error })

    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
    })
  }
})
