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
