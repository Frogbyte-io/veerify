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
  // Support notifications default on: being handed a ticket, or named in a
  // note, is directed at one specific person and is the kind of thing they
  // are expected to act on.
  conversationAssigned: true,
  conversationMentions: true,
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const [dbUser] = await db.select({ settings: user.settings }).from(user).where(eq(user.id, session.user.id)).limit(1)

  const prefs = {
    ...DEFAULT_PREFERENCES,
    ...(dbUser?.settings?.notificationPreferences || {}),
  }

  return createSuccessResponse(prefs)
})
