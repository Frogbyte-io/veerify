/**
 * @openapi
 * /api/marketing/teams/{teamId}/data-consent:
 *   put:
 *     tags: [Marketing]
 *     summary: Set which text sources may be sent to the team's AI provider
 *     description: >
 *       Team admin only. Records who changed it and when. Turning a source off
 *       takes effect immediately; every run re-reads consent.
 *     operationId: setMarketingDataConsent
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
 *             required: [allowFeedbackText, allowSupportText]
 *             properties:
 *               allowFeedbackText: { type: boolean }
 *               allowSupportText: { type: boolean }
 *     responses:
 *       200: { description: Updated consent }
 *       400: { description: Validation failed }
 *       403: { description: Team admin required }
 */
import { z } from 'zod'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  getConsentSummary,
  requireConsentAdmin,
  setConsent,
} from '~/server/services/marketing/customer-language/consent'

const bodySchema = z.object({ allowFeedbackText: z.boolean(), allowSupportText: z.boolean() })

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  await requireConsentAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  await setConsent(teamId, session.user.id, body)
  return createSuccessResponse({ ...(await getConsentSummary(teamId)), canManage: true })
})
