/**
 * @openapi
 * /api/workspace/data-consent:
 *   put:
 *     tags: [Marketing]
 *     summary: Set which text sources may be sent to the workspace's AI provider
 *     description: >
 *       Workspace owner or admin only. Records who changed it and when. Turning a source off
 *       takes effect immediately; every run re-reads consent.
 *     operationId: setMarketingDataConsent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [allowFeedbackText, allowSupportText]
 *             properties:
 *               allowFeedbackText: { type: boolean }
 *               allowSupportText: { type: boolean }
 *     responses:
 *       200: { description: Updated consent }
 *       400: { description: Validation failed }
 *       403: { description: Workspace owner or admin required }
 */
import { z } from 'zod'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import {
  getConsentSummary,
  requireConsentAdmin,
  setConsent,
} from '~/server/services/marketing/customer-language/consent'

const bodySchema = z.object({ allowFeedbackText: z.boolean(), allowSupportText: z.boolean() })

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  await requireConsentAdmin(organizationId, session.user.id)
  const body = await validateBody(event, bodySchema)

  await setConsent(organizationId, session.user.id, body)
  return createSuccessResponse({ ...(await getConsentSummary(organizationId)), canManage: true })
})
