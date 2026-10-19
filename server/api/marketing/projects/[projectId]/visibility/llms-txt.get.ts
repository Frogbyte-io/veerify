/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/llms-txt:
 *   get:
 *     tags: [Marketing]
 *     summary: Draft llms.txt for the product
 *     description: >
 *       Template-based draft (llmstxt.org format) from the product name and description,
 *       the site origin, public board and roadmap URLs, and the top crawled pages from
 *       the latest finished site audit. No LLM is involved.
 *     operationId: getLlmsTxtDraft
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Draft content }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Project or marketing site not found }
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { seoAudit, seoAuditPage } from '~/server/database/schema/marketing'
import { team } from '~/server/database/schema/auth'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { buildLlmsTxt, LLMS_TXT_MAX_PAGES } from '~/server/services/marketing/visibility/llms-txt'
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { resolveProductModules } from '~/lib/modules'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site, project } = await requireVisibilityRequest(event)

  const modules = resolveProductModules(project.settings as Record<string, unknown> | null)

  let boardUrl: string | null = null
  let roadmapUrl: string | null = null
  if (project.isPublic && (modules.feedbackEnabled || modules.roadmapEnabled)) {
    const [owner] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, project.teamId)).limit(1)
    const requestUrl = getRequestURL(event)
    const base = buildPublicBoardUrl({
      project: { slug: project.slug, customDomain: project.customDomain, settings: project.settings },
      teamSlug: owner?.slug ?? null,
      projectSlug: project.slug,
      appDomain: useRuntimeConfig().public.appDomain || 'localhost',
      protocol: requestUrl.protocol,
      port: requestUrl.port,
    })
    if (modules.feedbackEnabled) boardUrl = base
    if (modules.roadmapEnabled) roadmapUrl = `${base.replace(/\/+$/, '')}/roadmap`
  }

  let pages: { url: string; title: string | null }[] = []
  const [audit] = await db
    .select({ id: seoAudit.id })
    .from(seoAudit)
    .where(and(eq(seoAudit.siteId, site.id), eq(seoAudit.status, 'done')))
    .orderBy(desc(seoAudit.createdAt))
    .limit(1)
  if (audit) {
    const rows = await db
      .select({ url: seoAuditPage.url, facts: seoAuditPage.facts, statusCode: seoAuditPage.statusCode })
      .from(seoAuditPage)
      .where(eq(seoAuditPage.auditId, audit.id))
      .orderBy(asc(seoAuditPage.url))
    pages = rows
      .filter(
        (row) => row.statusCode >= 200 && row.statusCode < 300 && row.facts?.robotsMeta?.includes('noindex') !== true
      )
      // Shallow pages first: they are the ones worth pointing assistants at
      .sort((a, b) => a.url.length - b.url.length)
      .slice(0, LLMS_TXT_MAX_PAGES)
      .map((row) => ({ url: row.url, title: row.facts?.title ?? null }))
  }

  const content = buildLlmsTxt({
    name: project.name,
    description: project.description,
    origin: site.origin,
    boardUrl,
    roadmapUrl,
    pages,
  })

  return createSuccessResponse({ content, pageCount: pages.length })
})
