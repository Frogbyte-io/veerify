/**
 * @openapi
 * /api/support/inboxes:
 *   post:
 *     tags: [Support]
 *     summary: Create an inbox
 *     description: >
 *       The creator is added as a supportInboxMember with role "admin" in the
 *       same transaction - otherwise a team member who isn't a team admin
 *       could create an inbox they have no access to afterward.
 *     operationId: createSupportInbox
 *     responses:
 *       200: { description: Inbox created }
 *       400: { description: projectId does not belong to this team }
 *       403: { description: Not a member of the team }
 *       409: { description: An inbox with this slug already exists in the team }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxMember } from '~/server/database/schema/support'
import { project } from '~/server/database/schema/feedback'

const bodySchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: commonSchemas.slug,
  projectId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  await requireTeamAdmin(body.teamId, session.user.id)

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, body.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  const now = new Date()
  const inboxId = randomUUID()

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(supportInbox)
        .values({
          id: inboxId,
          teamId: body.teamId,
          projectId: body.projectId ?? null,
          name: body.name,
          slug: body.slug,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await tx.insert(supportInboxMember).values({
        id: randomUUID(),
        inboxId,
        userId: session.user.id,
        role: 'admin',
        createdAt: now,
      })

      return createSuccessResponse({ inbox: created })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'An inbox with this slug or email address already exists'),
      })
    }
    throw error
  }
})
