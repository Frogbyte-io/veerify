/**
 * @openapi
 * /api/support/inboxes/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update inbox settings
 *     description: >
 *       Covers name, slug, product mapping, default assignee, signature,
 *       enabled state, and the sending identity (emailAddress, fromName)
 *       used as the From on outgoing replies (Stage 04). Channel/provider
 *       configuration (webhook credentials, forwarding) is deployment env
 *       config, not editable here.
 *     operationId: updateSupportInbox
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Inbox updated }
 *       400: { description: projectId or defaultAssigneeUserId does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 *       409: { description: Another inbox already uses this slug or email address }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox } from '~/server/database/schema/support'
import { project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: commonSchemas.slug.optional(),
  projectId: z.string().nullable().optional(),
  defaultAssigneeUserId: z.string().nullable().optional(),
  signature: z.string().max(10_000).nullable().optional(),
  isEnabled: z.boolean().optional(),
  // Sending identity for outgoing replies (Stage 04). Null clears the
  // address entirely, which is deliberate: falling back to some default
  // would send as an address nobody chose.
  emailAddress: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
  fromName: z.string().trim().max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxRole(inboxId, session.user.id, 'admin')

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, inbox.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  if (body.defaultAssigneeUserId) {
    const [matchedMember] = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, inbox.teamId), eq(teamMember.userId, body.defaultAssigneeUserId)))
      .limit(1)

    if (!matchedMember) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'defaultAssigneeUserId is not a member of this team'),
      })
    }
  }

  try {
    const [updated] = await db
      .update(supportInbox)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.defaultAssigneeUserId !== undefined ? { defaultAssigneeUserId: body.defaultAssigneeUserId } : {}),
        ...(body.signature !== undefined ? { signature: body.signature } : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.emailAddress !== undefined ? { emailAddress: body.emailAddress } : {}),
        ...(body.fromName !== undefined ? { fromName: body.fromName } : {}),
        updatedAt: new Date(),
      })
      .where(eq(supportInbox.id, inboxId))
      .returning()

    return createSuccessResponse({ inbox: updated })
  } catch (error) {
    // `support_inbox_email_address_idx` is checked first: emailAddress is
    // the field an operator is more likely to be actively editing here, and
    // the generic slug message would be a misleading answer to "why did my
    // From address change fail".
    if (isUniqueViolation(error, 'support_inbox_email_address_idx')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Another inbox already uses this email address'),
      })
    }
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Another inbox in this team already uses this slug'),
      })
    }
    throw error
  }
})
