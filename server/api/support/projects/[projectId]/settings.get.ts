/**
 * @openapi
 * /api/support/projects/{projectId}/settings:
 *   get:
 *     tags: [Support]
 *     summary: Get support project settings
 *     operationId: getSupportProjectSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Support project settings }
 *       403: { description: Not a member of the project }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { capabilitiesForRole, resolveSupportProjectRole, type SupportInboxRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportProjectSettings } from '~/server/database/schema/support'

const DEFAULT_REPORTING_TIMEZONE = 'UTC'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const resolvedSupportRole = await resolveSupportProjectRole(projectId, session.user.id)
  const effectiveRole: SupportInboxRole | null = resolvedSupportRole?.effectiveRole ?? null
  const isProjectAdmin = resolvedSupportRole?.isProjectAdmin ?? false

  const [settings] = await db
    .select()
    .from(supportProjectSettings)
    .where(eq(supportProjectSettings.projectId, projectId))
    .limit(1)
  return createSuccessResponse({
    settings: settings ?? {
      projectId,
      autoLinkFeedback: false,
      reportingTimezone: DEFAULT_REPORTING_TIMEZONE,
      createdAt: null,
      updatedAt: null,
    },
    effectiveRole,
    isProjectAdmin,
    capabilities: capabilitiesForRole(effectiveRole, isProjectAdmin),
  })
})
