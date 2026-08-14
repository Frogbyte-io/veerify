/**
 * @openapi
 * /api/support/companies/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update a company
 *     operationId: updateSupportCompany
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Company updated }
 *       403: { description: Not a member of the company's team }
 *       404: { description: Company not found }
 *       409: { description: Another company in the team already uses this name or domain }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireCompanyAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { db } from '~/server/database/drizzle'
import { supportCompany } from '~/server/database/schema/support'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().toLowerCase().max(253).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const companyId = getRouterParam(event, 'id') as string
  const body = bodySchema.parse(await readBody(event))

  await requireCompanyAccess(companyId, session.user.id)

  try {
    const [updated] = await db
      .update(supportCompany)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.domain !== undefined ? { domain: body.domain } : {}),
        ...(body.attributes !== undefined ? { attributes: body.attributes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(supportCompany.id, companyId))
      .returning()

    return createSuccessResponse({ company: updated })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Another company in this team already uses this name or domain'),
      })
    }
    throw error
  }
})
