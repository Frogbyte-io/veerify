/**
 * @openapi
 * /api/support/companies:
 *   post:
 *     tags: [Support]
 *     summary: Create a company
 *     operationId: createSupportCompany
 *     responses:
 *       200: { description: Company created }
 *       403: { description: Not a member of the team }
 *       409: { description: A company with this name or domain already exists in the team }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { db } from '~/server/database/drizzle'
import { supportCompany } from '~/server/database/schema/support'

const bodySchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().toLowerCase().max(253).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = bodySchema.parse(await readBody(event))

  await requireTeamMembership(body.teamId, session.user.id)

  const now = new Date()

  try {
    const [created] = await db
      .insert(supportCompany)
      .values({
        id: randomUUID(),
        teamId: body.teamId,
        name: body.name,
        domain: body.domain ?? null,
        attributes: body.attributes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return createSuccessResponse({ company: created })
  } catch (error) {
    // `supportCompany` is uniquely indexed on (teamId, name) and (teamId,
    // domain), so either collision lands here rather than a pre-check --
    // two concurrent creates can both pass a pre-check and one still fails.
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'A company with this name or domain already exists in this team'),
      })
    }
    throw error
  }
})
