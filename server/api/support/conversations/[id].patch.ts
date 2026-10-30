/**
 * @openapi
 * /api/support/conversations/{id}:
 *   patch:
 *     tags: [Support]
 *     summary: Update a conversation's status, priority, assignee, subject, type, or folder
 *     description: >
 *       Every status, priority, assignee, and folder change also writes an
 *       `activity` message into the thread, in the same transaction as the
 *       update. Subject changes deliberately do not - they are not an
 *       operational event worth an inline feed entry.
 *
 *       Archive is `status: closed` (labelled Archived in the UI). Spam and
 *       Trash are folders, not statuses: `spam: true` sets `spamAt`, `spam: false`
 *       clears it; `deleted: true` sets `deletedAt` (the conversation is purged
 *       permanently after 30 days), `deleted: false` restores it. A conversation
 *       keeps its status while in a folder, and re-sending the current state is
 *       a no-op.
 *
 *       `behaviour` switches the conversation between plain mail (`mail`) and a
 *       support case (`helpdesk`; SLA, auto-replies, CSAT and automation rules
 *       apply). A real change writes an `activity` message ("Turned this into
 *       a support case." / "Turned this into plain mail."). Becoming a support
 *       case assigns the SLA policy that applies now; becoming plain mail clears
 *       `slaPolicyId`, the three due dates and `slaPausedAt`. The case number
 *       (`displayId`) never changes. Permissions are the same as for status changes: any member of
 *       the conversation's inbox who can work conversations (agent, supervisor,
 *       admin) or a project admin.
 *     operationId: updateSupportConversation
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [open, pending, resolved, snoozed, closed] }
 *               priority: { type: string, enum: [low, normal, high, urgent], nullable: true }
 *               assigneeUserId: { type: string, nullable: true }
 *               subject: { type: string, maxLength: 500, nullable: true }
 *               behaviour: { type: string, enum: [mail, helpdesk], description: Turn the conversation into plain mail or a support case }
 *               spam: { type: boolean, description: Move to Spam (true) or back out of it (false) }
 *               deleted: { type: boolean, description: Move to Trash (true) or restore (false) }
 *     responses:
 *       200: { description: Conversation updated }
 *       400: { description: assigneeUserId does not belong to this project }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { updateConversation } from '~/server/utils/conversation-update'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  subject: z.string().trim().max(500).nullable().optional(),
  behaviour: z.enum(['mail', 'helpdesk']).optional(),
  spam: z.boolean().optional(),
  deleted: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  // A foreign key proves the user and project exist, not that they belong to
  // this conversation's project - same cross-tenant gap Stage 01 closed for
  // contacts and companies.
  if (body.assigneeUserId) {
    if (!(await hasProjectAccess(existing.projectId, body.assigneeUserId))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Assignee is not a member of this project'),
      })
    }
  }

  const result = await updateConversation({ existing, patch: body, actor: session.user })
  return createSuccessResponse(result)
})
