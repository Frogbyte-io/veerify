/**
 * @openapi
 * /api/marketing/projects/{projectId}/audits/{auditId}/cancel:
 *   post:
 *     tags: [Marketing]
 *     summary: Cancel a running site audit
 *     description: Cancels a queued, crawling or analyzing audit; stops the provider crawl job when one is running.
 *     operationId: cancelMarketingAudit
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Audit cancelled }
 *       403: { description: Marketing not enabled or no access }
 *       404: { description: Audit not found for this product }
 *       409: { description: Audit already finished }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireAuditAccess } from '~/server/utils/marketing-audit-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { cancelAudit } from '~/server/services/marketing/audit/runner'
import { ACTIVE_STATUSES } from '~/server/services/marketing/audit/store'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const auditId = getRouterParam(event, 'auditId') as string
  const { audit } = await requireAuditAccess(projectId, auditId, session.user.id)

  if (!ACTIVE_STATUSES.includes(audit.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This audit has already finished'),
    })
  }

  await cancelAudit(audit.id)
  return createSuccessResponse({ id: audit.id, status: 'cancelled' })
})
