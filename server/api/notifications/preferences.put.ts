/**
 * @openapi
 * /api/notifications/preferences:
 *   put:
 *     tags: [Notifications]
 *     summary: Update notification preferences
 *     description: >
 *       Merges the given flags into the caller's stored preferences; omitted flags keep their value and unknown keys are dropped. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateNotificationPreferences
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailNotifications: { type: boolean }
 *               inAppNotifications: { type: boolean }
 *               newFeedback: { type: boolean }
 *               statusChanges: { type: boolean }
 *               newComments: { type: boolean }
 *               conversationAssigned: { type: boolean }
 *               conversationMentions: { type: boolean }
 *               marketingDigest: { type: boolean, description: "Daily Marketing mentions digest email (team admins only receive it)" }
 *     responses:
 *       200: { description: "The full stored preferences object after the merge" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 */
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
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
  marketingDigest: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, preferencesSchema)

  // Get current settings
  const [dbUser] = await db.select({ settings: user.settings }).from(user).where(eq(user.id, session.user.id)).limit(1)

  const currentSettings = dbUser?.settings || {}
  const currentPrefs = currentSettings.notificationPreferences || {}

  const updatedPrefs = { ...currentPrefs, ...body }

  // Merge only this key, so a concurrent write to another settings key (e.g. lastContext) is kept.
  await db
    .update(user)
    .set({
      settings: sql`coalesce(${user.settings}, '{}'::jsonb) || jsonb_build_object('notificationPreferences', ${JSON.stringify(updatedPrefs)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(user.id, session.user.id))

  return createSuccessResponse(updatedPrefs)
})
