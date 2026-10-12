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
import { and, asc, desc, eq, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { seoAudit, seoIssue } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireAuditAccess } from '~/server/utils/marketing-audit-access'
import { createSuccessResponse } from '~/server/utils/response'
import { AUDIT_RULES } from '~/server/services/marketing/audit/rules'

const MAX_AFFECTED_PER_RULE = 50
const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, notice: 2 }

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const auditId = getRouterParam(event, 'auditId') as string
  const { audit } = await requireAuditAccess(projectId, auditId, session.user.id)

  // Per-(rule, severity) totals in SQL, plus at most MAX_AFFECTED_PER_RULE rows per rule
  const totals = await db
    .select({ ruleId: seoIssue.ruleId, severity: seoIssue.severity, total: sql<number>`count(*)::int` })
    .from(seoIssue)
    .where(eq(seoIssue.auditId, audit.id))
    .groupBy(seoIssue.ruleId, seoIssue.severity)

  const ranked = db
    .select({
      ruleId: seoIssue.ruleId,
      pageUrl: seoIssue.pageUrl,
      details: seoIssue.details,
      rn: sql<number>`row_number() over (partition by ${seoIssue.ruleId} order by ${seoIssue.pageUrl}, ${seoIssue.id})`.as(
        'rn'
      ),
    })
    .from(seoIssue)
    .where(eq(seoIssue.auditId, audit.id))
    .as('ranked')
  const rows = await db
    .select({ ruleId: ranked.ruleId, pageUrl: ranked.pageUrl, details: ranked.details })
    .from(ranked)
    .where(lte(ranked.rn, MAX_AFFECTED_PER_RULE))
    .orderBy(asc(ranked.ruleId), asc(ranked.pageUrl))

  const rulesById = new Map(AUDIT_RULES.map((rule) => [rule.id, rule]))
  const bySeverity = { error: 0, warning: 0, notice: 0 } as Record<string, number>
  const byRule: Record<string, number> = {}
  const groups = new Map<
    string,
    { affected: Array<{ url: string | null; details: Record<string, unknown> }>; total: number }
  >()
  let totalIssues = 0
  for (const row of totals) {
    const count = Number(row.total)
    bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + count
    byRule[row.ruleId] = (byRule[row.ruleId] ?? 0) + count
    totalIssues += count
    const group = groups.get(row.ruleId) ?? { affected: [], total: 0 }
    group.total += count
    groups.set(row.ruleId, group)
  }
  for (const row of rows) {
    groups.get(row.ruleId)?.affected.push({ url: row.pageUrl, details: row.details })
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
    summary: { bySeverity, byRule, total: totalIssues },
    siteFacts: audit.status === 'done' ? siteFacts : null,
    issues: grouped,
  })
})
