/**
 * @openapi
 * /api/marketing/teams/{teamId}/erase-contact:
 *   post:
 *     tags: [Marketing]
 *     summary: Erase a person's Marketing data
 *     description: >
 *       Team admin only. Deletes every review request and testimonial for the email address
 *       (case-insensitive) across the team's products, and keeps or creates a suppression so the
 *       address is never contacted again. Works whether or not Marketing is switched on.
 *     operationId: eraseMarketingContact
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Counts of deleted review requests and testimonials }
 *       400: { description: Validation failed }
 *       403: { description: Team admin required }
 */
import { z } from 'zod'
import { eraseContact } from '~/server/services/marketing/privacy'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ email: z.string().trim().email('Enter a valid email address').max(254) })

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  try {
    await requireTeamAdmin(teamId, session.user.id)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 403) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, "Only team admins can erase a person's data"),
      })
    }
    throw error
  }
  const body = await validateBody(event, bodySchema)

  return createSuccessResponse(await eraseContact(teamId, body.email))
})
