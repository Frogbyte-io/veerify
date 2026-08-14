/**
 * @openapi
 * /api/support/contacts/{id}/links/{linkId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove an explicit contact link
 *     operationId: deleteSupportContactLink
 *     responses:
 *       200: { description: Link removed }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact or link not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contactLink } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const linkId = getRouterParam(event, 'linkId') as string
  await requireContactAccess(contactId, session.user.id)

  const [deleted] = await db
    .delete(contactLink)
    .where(and(eq(contactLink.id, linkId), eq(contactLink.contactId, contactId)))
    .returning({ id: contactLink.id })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact link not found'),
    })
  }

  return createSuccessResponse({ deleted: true })
})
