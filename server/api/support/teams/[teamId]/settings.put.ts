/**
 * @openapi
 * /api/support/teams/{teamId}/settings:
 *   put:
 *     tags: [Support]
 *     summary: Change support team settings
 *     operationId: updateSupportTeamSettings
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportTeamSettings } from '~/server/database/schema/support'

const bodySchema = z.object({ autoLinkFeedback: z.boolean() })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamMembership(teamId, session.user.id)
  const body = bodySchema.parse(await readBody(event))
  const now = new Date()

  const [settings] = await db
    .insert(supportTeamSettings)
    .values({ teamId, autoLinkFeedback: body.autoLinkFeedback, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: supportTeamSettings.teamId,
      set: { autoLinkFeedback: body.autoLinkFeedback, updatedAt: now },
    })
    .returning()

  return createSuccessResponse({ settings })
})
