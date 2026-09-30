/**
 * @openapi
 * /api/support/inboxes/{id}/members:
 *   get:
 *     tags: [Support]
 *     summary: List an inbox's agent members
 *     operationId: listSupportInboxMembers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Member list }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportInboxMember } from '~/server/database/schema/support'
import { user } from '~/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  await requireInboxAccess(inboxId, session.user.id)

  const members = await db
    .select({
      id: supportInboxMember.id,
      userId: supportInboxMember.userId,
      role: supportInboxMember.role,
      createdAt: supportInboxMember.createdAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(supportInboxMember)
    .innerJoin(user, eq(supportInboxMember.userId, user.id))
    .where(eq(supportInboxMember.inboxId, inboxId))

  return createSuccessResponse({ members })
})
