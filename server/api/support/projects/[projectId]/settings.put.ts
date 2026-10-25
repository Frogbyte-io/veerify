/**
 * @openapi
 * /api/support/projects/{projectId}/settings:
 *   put:
 *     tags: [Support]
 *     summary: Change support project settings
 *     operationId: updateSupportProjectSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Support project settings updated }
 *       403: { description: Not a member of the project }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportProjectSettings } from '~/server/database/schema/support'
import { lockContactProject } from '~/server/utils/contact-lock'
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
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)
  const now = new Date()

  const settings = await db.transaction(async (tx) => {
    await lockContactProject(tx, projectId)

    const [updated] = await tx
      .insert(supportProjectSettings)
      .values({
        projectId,
        autoLinkFeedback: body.autoLinkFeedback,
        reportingTimezone: body.reportingTimezone ?? DEFAULT_REPORTING_TIMEZONE,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: supportProjectSettings.projectId,
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
