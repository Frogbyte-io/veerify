import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'

// Keys must stay in step with `DEFAULT_PREFERENCES` in `preferences.get.ts`
// and `PREFERENCE_KEY_BY_TYPE` in `server/utils/notifications.ts`: a key
// missing here is silently dropped, so its toggle appears to work and then
// resets on reload.
const preferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
  newFeedback: z.boolean().optional(),
  statusChanges: z.boolean().optional(),
  newComments: z.boolean().optional(),
  conversationAssigned: z.boolean().optional(),
  conversationMentions: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, preferencesSchema)

  // Get current settings
  const [dbUser] = await db
    .select({ settings: user.settings })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  const currentSettings = dbUser?.settings || {}
  const currentPrefs = currentSettings.notificationPreferences || {}

  const updatedPrefs = { ...currentPrefs, ...body }
  const updatedSettings = { ...currentSettings, notificationPreferences: updatedPrefs }

  await db
    .update(user)
    .set({ settings: updatedSettings, updatedAt: new Date() })
    .where(eq(user.id, session.user.id))

  return createSuccessResponse(updatedPrefs)
})
