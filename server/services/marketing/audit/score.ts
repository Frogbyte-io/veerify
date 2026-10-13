import type { AuditIssue, IssueSeverity } from './types'

export const SEVERITY_WEIGHT: Record<IssueSeverity, number> = { error: 30, warning: 5, notice: 0.5 }

/** Page-level weight is averaged per page, then multiplied by this factor. */
export const PAGE_ISSUE_SCALE = 2

/** A site-level error (for example robots.txt blocking Googlebot) caps the score here. */
export const SITE_ERROR_CAP = 60

/**
 * Score formula (integer 0-100):
 *
 *   siteWeight = sum of severity weights of site-level issues (pageUrl === null)
 *   pageWeight = sum of severity weights of page-level issues
 *   penalty    = siteWeight + PAGE_ISSUE_SCALE * (pageWeight / max(pageCount, 1))
 *   score      = floor(clamp(100 - penalty, 0, 100))  (any issue keeps the score below 100)
 *   score      = min(score, SITE_ERROR_CAP) when any site-level error exists
 *
 * Weights: error 30, warning 5, notice 0.5. Page-level issues are averaged per page,
 * so a 500-page site is not punished for size: one warning on every page costs
 * 2 * 5 = 10 points regardless of how many pages there are. Site-level issues count
 * once, in full.
 *
 * Calibration: no issues = 100; a decent page with only notices (og tags, twitter
 * card, ...) ~ 85-92; missing meta description + h1 + sitemap plus those notices
 * ~ 60-70; a site blocking search crawlers is capped at 60.
 */
export function computeScore(issues: AuditIssue[], pageCount: number): number {
  let siteWeight = 0
  let pageWeight = 0
  let siteError = false
  for (const issue of issues) {
    const weight = SEVERITY_WEIGHT[issue.severity]
    if (issue.pageUrl === null) {
      siteWeight += weight
      if (issue.severity === 'error') siteError = true
    } else pageWeight += weight
  }
  const penalty = siteWeight + PAGE_ISSUE_SCALE * (pageWeight / Math.max(pageCount, 1))
  const score = Math.floor(Math.min(100, Math.max(0, 100 - penalty)))
  return siteError ? Math.min(score, SITE_ERROR_CAP) : score
}

export interface IssueSummary {
  bySeverity: Record<IssueSeverity, number>
  byRule: Record<string, number>
  total: number
}

export function summarizeIssues(issues: AuditIssue[]): IssueSummary {
  const bySeverity: Record<IssueSeverity, number> = { error: 0, warning: 0, notice: 0 }
  const byRule: Record<string, number> = {}
  for (const issue of issues) {
    bySeverity[issue.severity]++
    byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1
  }
  return { bySeverity, byRule, total: issues.length }
}
