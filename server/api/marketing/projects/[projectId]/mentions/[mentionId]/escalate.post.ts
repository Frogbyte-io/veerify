/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions/{mentionId}/escalate:
 *   post:
 *     tags: [Marketing]
 *     summary: Escalate a mention to a support conversation
 *     description: >
 *       Creates a conversation in the team's support inbox whose first message is an internal
 *       note (never sent to anyone) describing the mention, and marks the mention escalated.
 *       Idempotent: escalating again returns the existing conversation. Requires the Support
 *       module and access to a support inbox.
 *     operationId: escalateMarketingMention
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: mentionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "escalated: true. Conversation id, inbox id and display id are included only when the caller can open that inbox" }
 *       403: { description: Not a team member, Marketing is off, or no access to a support inbox }
 *       404: { description: Mention not found for this product }
 *       409: { description: Support is not enabled for this team }
 */
import {
  canAccessInbox,
  escalateMention,
  isSupportEnabled,
  pickEscalationInbox,
} from '~/server/services/marketing/mentions/escalation'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireMarketingSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { SUPPORT_INBOX_FORBIDDEN_MESSAGE } from '~/server/utils/support-access'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const mentionId = requireRouterParam(event, 'mentionId', 'Mention ID')
  const { teamId } = await requireMarketingAccess(projectId, session.user.id)
  const site = await requireMarketingSite(projectId)

  if (!(await isSupportEnabled(teamId))) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'Support is not enabled for this team. Turn it on to escalate mentions.'
      ),
    })
  }

  const inbox = await pickEscalationInbox(teamId, projectId, session.user.id)
  if (!inbox) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, SUPPORT_INBOX_FORBIDDEN_MESSAGE),
    })
  }

  const result = await escalateMention({
    siteId: site.id,
    mentionId,
    teamId,
    projectId,
    userId: session.user.id,
    inbox,
  })

  // An already-escalated mention may sit in an inbox this user cannot open: confirm it without leaking ids.
  if (result.alreadyEscalated && !(await canAccessInbox(result.inboxId, session.user.id))) {
    return createSuccessResponse({ escalated: true, alreadyEscalated: true })
  }

  return createSuccessResponse({
    escalated: true,
    conversationId: result.conversationId,
    inboxId: result.inboxId,
    displayId: result.displayId,
    alreadyEscalated: result.alreadyEscalated,
  })
})
