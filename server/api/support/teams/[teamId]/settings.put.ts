/**
 * @openapi
 * /api/support/teams/{teamId}/settings:
 *   put:
 *     tags: [Support]
 *     summary: Change support team settings
 *     operationId: updateSupportTeamSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Support team settings updated }
 *       403: { description: Not a member of the team }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportTeamSettings } from '~/server/database/schema/support'
import { lockContactTeam } from '~/server/utils/contact-lock'
import { isValidReportingTimezone } from '~/server/utils/support-reporting-calendar'

const DEFAULT_REPORTING_TIMEZONE = 'UTC'
const bodySchema = z.object({
  autoLinkFeedback: z.boolean(),
  reportingTimezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(isValidReportingTimezone, 'reportingTimezone must be a valid IANA timezone')
    .optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)
  const now = new Date()

  const settings = await db.transaction(async (tx) => {
    await lockContactTeam(tx, teamId)

    const [updated] = await tx
      .insert(supportTeamSettings)
      .values({
        teamId,
        autoLinkFeedback: body.autoLinkFeedback,
        reportingTimezone: body.reportingTimezone ?? DEFAULT_REPORTING_TIMEZONE,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: supportTeamSettings.teamId,
        set: {
          autoLinkFeedback: body.autoLinkFeedback,
          ...(body.reportingTimezone ? { reportingTimezone: body.reportingTimezone } : {}),
          updatedAt: now,
        },
      })
      .returning()

    return updated
  })

  return createSuccessResponse({ settings })
})
