/**
 * @openapi
 * /api/marketing/projects/{projectId}/audits/{auditId}:
 *   get:
 *     tags: [Marketing]
 *     summary: Get a site audit with its issues
 *     description: >
 *       Status and progress, score and the previous audit's score, an issue
 *       summary, site facts (robots.txt, llms.txt, sitemap, AI crawler access,
 *       PageSpeed) and issues grouped by rule with up to 50 affected pages each.
 *     operationId: getMarketingAudit
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
 *       200: { description: Audit detail }
 *       403: { description: Marketing not enabled or no access }
 *       404: { description: Audit not found for this product }
 */
import { and, asc, desc, eq, isNotNull, lt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { seoAudit, seoIssue } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireAuditAccess } from '~/server/utils/marketing-audit-access'
import { createSuccessResponse } from '~/server/utils/response'
import { AUDIT_RULES } from '~/server/services/marketing/audit/rules'
import { summarizeIssues } from '~/server/services/marketing/audit/score'
import type { AuditIssue, IssueSeverity } from '~/server/services/marketing/audit/types'

const MAX_AFFECTED_PER_RULE = 50
const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, notice: 2 }

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const auditId = getRouterParam(event, 'auditId') as string
  const { audit } = await requireAuditAccess(projectId, auditId, session.user.id)

  const rows = await db
    .select({
      ruleId: seoIssue.ruleId,
      severity: seoIssue.severity,
      pageUrl: seoIssue.pageUrl,
      details: seoIssue.details,
    })
    .from(seoIssue)
    .where(eq(seoIssue.auditId, audit.id))
    .orderBy(asc(seoIssue.pageUrl))

  const issues: AuditIssue[] = rows.map((row) => ({
    ruleId: row.ruleId,
    severity: row.severity as IssueSeverity,
    pageUrl: row.pageUrl,
    details: row.details,
  }))

  const rulesById = new Map(AUDIT_RULES.map((rule) => [rule.id, rule]))
  const groups = new Map<
    string,
    { affected: Array<{ url: string | null; details: Record<string, unknown> }>; total: number }
  >()
  for (const issue of issues) {
    const group = groups.get(issue.ruleId) ?? { affected: [], total: 0 }
    group.total++
    if (group.affected.length < MAX_AFFECTED_PER_RULE) {
      group.affected.push({ url: issue.pageUrl, details: issue.details })
    }
    groups.set(issue.ruleId, group)
  }

  const grouped = [...groups.entries()]
    .map(([ruleId, group]) => {
      const rule = rulesById.get(ruleId)
      return {
        ruleId,
        title: rule?.title ?? ruleId,
        guidance: rule?.guidance ?? '',
        severity: rule?.severity ?? 'notice',
        scope: rule?.scope ?? 'page',
        total: group.total,
        affected: group.affected,
      }
    })
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
        b.total - a.total ||
        a.title.localeCompare(b.title)
    )

  const [previous] = await db
    .select({ score: seoAudit.score })
    .from(seoAudit)
    .where(
      and(
        eq(seoAudit.siteId, audit.siteId),
        eq(seoAudit.status, 'done'),
        isNotNull(seoAudit.score),
        lt(seoAudit.createdAt, audit.createdAt)
      )
    )
    .orderBy(desc(seoAudit.createdAt))
    .limit(1)

  // Internal runner state (lease, error counter) is not part of the API
  const { _runtime: _internal, ...siteFacts } = (audit.siteFacts ?? {}) as Record<string, unknown>

  return createSuccessResponse({
    id: audit.id,
    status: audit.status,
    mode: audit.mode,
    trigger: audit.trigger,
    error: audit.error,
    score: audit.score,
    previousScore: previous?.score ?? null,
    pagesFetched: audit.pagesFetched,
    pageLimit: audit.pageLimit,
    startedAt: audit.startedAt,
    finishedAt: audit.finishedAt,
    summary: summarizeIssues(issues),
    siteFacts: audit.status === 'done' ? siteFacts : null,
    issues: grouped,
  })
})
