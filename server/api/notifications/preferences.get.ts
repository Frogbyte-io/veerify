import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'

const DEFAULT_PREFERENCES = {
  emailNotifications: true,
  inAppNotifications: true,
  newFeedback: true,
  statusChanges: true,
  newComments: true,
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const [dbUser] = await db
    .select({ settings: user.settings })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  const prefs = {
    ...DEFAULT_PREFERENCES,
    ...(dbUser?.settings?.notificationPreferences || {}),
  }

  return createSuccessResponse(prefs)
})
