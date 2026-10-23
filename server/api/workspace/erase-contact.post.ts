/**
 * @openapi
 * /api/workspace/erase-contact:
 *   post:
 *     tags: [Marketing]
 *     summary: Erase a person's Marketing data
 *     description: >
 *       Workspace owner or admin only. Deletes every review request and testimonial for the email address
 *       (case-insensitive) across the workspace's projects, and keeps or creates a suppression so the
 *       address is never contacted again. Works whether or not Marketing is switched on.
 *     operationId: eraseMarketingContact
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
 *       403: { description: Workspace owner or admin required }
 */
import { z } from 'zod'
import { eraseContact } from '~/server/services/marketing/privacy'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireOrganizationAdmin } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ email: z.string().trim().email('Enter a valid email address').max(254) })

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  try {
    await requireOrganizationAdmin(organizationId, session.user.id)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 403) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, "Only workspace owners and admins can erase a person's data"),
      })
    }
    throw error
  }
  const body = await validateBody(event, bodySchema)

  return createSuccessResponse(await eraseContact(organizationId, body.email))
})
