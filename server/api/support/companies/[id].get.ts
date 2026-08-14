/**
 * @openapi
 * /api/support/companies/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get a company
 *     operationId: getSupportCompany
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Company detail }
 *       403: { description: Not a member of the company's team }
 *       404: { description: Company not found }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireCompanyAccess } from '~/server/utils/support-access'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const companyId = getRouterParam(event, 'id') as string

  const company = await requireCompanyAccess(companyId, session.user.id)

  return createSuccessResponse({ company })
})
