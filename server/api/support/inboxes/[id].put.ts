/**
 * @openapi
 * /api/support/inboxes/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update inbox settings
 *     description: >
 *       Covers name, slug, product mapping, default assignee, signature, and
 *       enabled state. Channel/provider configuration (sending address,
 *       forwarding, auto-reply) is Stage 03.
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
 *       409: { description: Another inbox in the team already uses this slug }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
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
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxAccess(inboxId, session.user.id)

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
        updatedAt: new Date(),
      })
      .where(eq(supportInbox.id, inboxId))
      .returning()

    return createSuccessResponse({ inbox: updated })
  } catch (error) {
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
