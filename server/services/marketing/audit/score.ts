import type { AuditIssue, IssueSeverity } from './types'

export const SEVERITY_WEIGHT: Record<IssueSeverity, number> = { error: 10, warning: 4, notice: 1 }

/** How many penalty points one weighted issue per page, on average, costs. */
export const PAGE_ISSUE_SCALE = 5

/**
 * Score formula (integer 0-100):
 *
 *   siteWeight = sum of severity weights of site-level issues (pageUrl === null)
 *   pageWeight = sum of severity weights of page-level issues
 *   penalty    = siteWeight + PAGE_ISSUE_SCALE * (pageWeight / max(pageCount, 1))
 *   score      = round(clamp(100 - penalty, 0, 100))
 *
 * Weights: error 10, warning 4, notice 1. Page-level issues are averaged per page, so
 * a 500-page site is not punished for size: one warning on every page costs
 * 5 * 4 = 20 points regardless of how many pages there are. Site-level issues count
 * once, in full.
 */
export function computeScore(issues: AuditIssue[], pageCount: number): number {
  let siteWeight = 0
  let pageWeight = 0
  for (const issue of issues) {
    const weight = SEVERITY_WEIGHT[issue.severity]
    if (issue.pageUrl === null) siteWeight += weight
    else pageWeight += weight
  }
  const penalty = siteWeight + PAGE_ISSUE_SCALE * (pageWeight / Math.max(pageCount, 1))
  return Math.round(Math.min(100, Math.max(0, 100 - penalty)))
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
