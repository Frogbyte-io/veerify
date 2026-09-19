/**
 * @openapi
 * /api/support/inboxes/{id}/members/{memberId}:
 *   patch:
 *     tags: [Support]
 *     summary: Change an inbox member role
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInboxMember } from '~/server/database/schema/support'

const bodySchema = z.object({ role: z.enum(['agent', 'supervisor', 'admin']) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const memberId = getRouterParam(event, 'memberId') as string
  const body = await validateBody(event, bodySchema)

  await requireInboxRole(inboxId, session.user.id, 'admin')

  const [updated] = await db
    .update(supportInboxMember)
    .set({ role: body.role })
    .where(and(eq(supportInboxMember.id, memberId), eq(supportInboxMember.inboxId, inboxId)))
    .returning()

  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Member not found on this inbox'),
    })
  }

  return createSuccessResponse({ member: updated })
})
