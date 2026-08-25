/**
 * @openapi
 * /api/support/teams/{teamId}/settings:
 *   get:
 *     tags: [Support]
 *     summary: Get support team settings
 *     operationId: getSupportTeamSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Support team settings }
 *       403: { description: Not a member of the team }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import {
  capabilitiesForRole,
  requireTeamMembership,
  type SupportInboxRole,
} from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportTeamSettings } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const membership = await requireTeamMembership(teamId, session.user.id)
  const isTeamAdmin = membership.role === 'admin'
  const effectiveRole: SupportInboxRole = isTeamAdmin ? 'admin' : 'agent'

  const [settings] = await db.select().from(supportTeamSettings).where(eq(supportTeamSettings.teamId, teamId)).limit(1)
  return createSuccessResponse({
    settings: settings ?? { teamId, autoLinkFeedback: false, createdAt: null, updatedAt: null },
    effectiveRole,
    isTeamAdmin,
    capabilities: capabilitiesForRole(effectiveRole, isTeamAdmin),
  })
})
