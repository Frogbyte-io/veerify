import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'
import { getAuthHeaders } from '~/server/utils/auth-headers'

export default defineEventHandler(async (event) => {
  try {
    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: getAuthHeaders(event),
    })

    if (!session?.user) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    }

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
        email: email.trim(),
        updatedAt: new Date(),
      })
      .where(eq(user.id, session.user.id))
      .returning()

    return {
      success: true,
      user: updatedUser[0],
    }
  } catch (error) {
    console.error('Profile update error:', error)

    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
    })
  }
})
