/**
 * @openapi
 * /api/support/companies/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a company
 *     description: >
 *       Hard delete. Contacts referencing this company have their companyId
 *       cleared (onDelete set null) rather than being deleted themselves.
 *     operationId: deleteSupportCompany
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Company deleted }
 *       403: { description: Not a member of the company's team }
 *       404: { description: Company not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireCompanyAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportCompany } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const companyId = getRouterParam(event, 'id') as string

  await requireCompanyAccess(companyId, session.user.id)

  await db.delete(supportCompany).where(eq(supportCompany.id, companyId))

  return createSuccessResponse({ deleted: true })
})
