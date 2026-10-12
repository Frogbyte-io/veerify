/**
 * @openapi
 * /api/marketing/projects/{projectId}/audits/{auditId}/pages:
 *   get:
 *     tags: [Marketing]
 *     summary: List pages fetched by a site audit
 *     description: Pages ordered by URL, 50 per request. Pass `nextCursor` as `cursor` for the next page.
 *     operationId: listMarketingAuditPages
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: auditId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pages with status code, title and issue count }
 *       403: { description: Marketing not enabled or no access }
 *       404: { description: Audit not found for this product }
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { seoAuditPage, seoIssue } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireAuditAccess } from '~/server/utils/marketing-audit-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'

const AUDIT_PAGES_PAGE_SIZE = 50

const querySchema = z.object({ cursor: z.string().max(2048).optional() })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const auditId = getRouterParam(event, 'auditId') as string
  const { audit } = await requireAuditAccess(projectId, auditId, session.user.id)
  const { cursor } = validateQuery(event, querySchema)

  const rows = await db
    .select({
      id: seoAuditPage.id,
      url: seoAuditPage.url,
      statusCode: seoAuditPage.statusCode,
      title: sql<string | null>`${seoAuditPage.facts}->>'title'`,
      error: sql<string | null>`${seoAuditPage.facts}->>'error'`,
    })
    .from(seoAuditPage)
    .where(
      cursor
        ? and(eq(seoAuditPage.auditId, audit.id), gt(seoAuditPage.url, cursor))
        : eq(seoAuditPage.auditId, audit.id)
    )
    .orderBy(asc(seoAuditPage.url))
    .limit(AUDIT_PAGES_PAGE_SIZE + 1)

  const hasMore = rows.length > AUDIT_PAGES_PAGE_SIZE
  const pageRows = rows.slice(0, AUDIT_PAGES_PAGE_SIZE)

  // One grouped count for the returned page ids (uses seo_issue_page_idx)
  const counts = pageRows.length
    ? await db
        .select({ pageId: seoIssue.pageId, count: sql<number>`count(*)::int` })
        .from(seoIssue)
        .where(
          inArray(
            seoIssue.pageId,
            pageRows.map((row) => row.id)
          )
        )
        .groupBy(seoIssue.pageId)
    : []
  const countByPage = new Map(counts.map((row) => [row.pageId, Number(row.count)]))
  const pages = pageRows.map((row) => ({ ...row, issueCount: countByPage.get(row.id) ?? 0 }))
  return createSuccessResponse({
    pages,
    nextCursor: hasMore ? pages[pages.length - 1].url : null,
  })
})
