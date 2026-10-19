/**
 * @openapi
 * /api/marketing/projects/{projectId}/audits:
 *   post:
 *     tags: [Marketing]
 *     summary: Start a manual site audit
 *     description: >
 *       Queues an audit of the product's verified site. Runs a full crawl when
 *       a Firecrawl key is available (team key or instance key), otherwise a
 *       basic audit of robots.txt, llms.txt, sitemap and the home page.
 *       Fails with 409 while another audit is running and 429 after the daily
 *       manual limit. Unverified sites are never fetched (403).
 *     operationId: startMarketingAudit
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Audit queued }
 *       403: { description: Not enabled, not verified or no access }
 *       409: { description: An audit is already running }
 *       429: { description: Daily manual audit limit reached }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { findSiteForProject } from '~/server/utils/marketing-audit-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { startAudit } from '~/server/services/marketing/audit/runner'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireMarketingAccess(projectId, session.user.id)

  const site = await findSiteForProject(projectId)
  if (!site) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Add and verify your site before running an audit'),
    })
  }

  const audit = await startAudit({ siteId: site.id, trigger: 'manual', userId: session.user.id })
  setResponseStatus(event, 201)
  return createSuccessResponse(audit)
})
