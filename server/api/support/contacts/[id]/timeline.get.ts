/**
 * @openapi
 * /api/support/contacts/{id}/timeline:
 *   get:
 *     tags: [Support]
 *     summary: Get a contact's feedback timeline
 *     operationId: getSupportContactTimeline
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: section
 *         required: false
 *         description: Limit the database work to one independently paginated section for UI consumers.
 *         schema: { type: string, enum: [linked, probable] }
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Number of rows per section. Defaults to 25 and is capped at 100.
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: linkedCursor
 *         required: false
 *         description: Opaque v1 cursor for the linked feedback section.
 *         schema: { type: string }
 *       - in: query
 *         name: probableCursor
 *         required: false
 *         description: Opaque v1 cursor for the probable feedback section.
 *         schema: { type: string }
 *     responses:
 *       200: { description: Independently paginated linked feedback and probable feedback suggestions }
 *       400: { description: Invalid limit, section, or opaque cursor }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { DEFAULT_TIMELINE_LIMIT, getContactTimeline, MAX_TIMELINE_LIMIT } from '~/server/utils/support-timeline'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_TIMELINE_LIMIT).default(DEFAULT_TIMELINE_LIMIT),
  linkedCursor: z.string().optional(),
  probableCursor: z.string().optional(),
  section: z.enum(['linked', 'probable']).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const contact = await requireContactAccess(contactId, session.user.id)
  const query = validateQuery(event, querySchema)

  return createSuccessResponse(
    await getContactTimeline(contact, {
      limit: query.limit,
      linkedCursor: query.linkedCursor,
      probableCursor: query.probableCursor,
      section: query.section,
    })
  )
})
