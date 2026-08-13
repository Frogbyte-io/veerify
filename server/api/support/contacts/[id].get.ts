/**
 * @openapi
 * /api/support/contacts/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get a contact with its identities and company
 *     operationId: getSupportContact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Contact detail }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contactIdentity, supportCompany } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string

  const row = await requireContactAccess(contactId, session.user.id)

  const identities = await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, contactId))

  const company = row.companyId
    ? ((await db.select().from(supportCompany).where(eq(supportCompany.id, row.companyId)).limit(1))[0] ?? null)
    : null

  return createSuccessResponse({ contact: row, identities, company })
})
