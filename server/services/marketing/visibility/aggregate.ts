/** Aggregation functions for AI visibility metrics across multiple runs. */

export interface AnalysisRow {
  promptId: string
  provider: string
  brandMentioned: boolean | null
  brandRank: number | null
  competitorsMentioned: { termId: string; label: string }[]
  citationDomains: string[]
}

/**
 * Calculate brand mention rate: (rows where brandMentioned is true) / (non-null rows)
 */
export function mentionRate(rows: AnalysisRow[]): { mentioned: number; total: number; rate: number } {
  const filtered = rows.filter((r) => r.brandMentioned !== null)
  const mentioned = filtered.filter((r) => r.brandMentioned).length
  const total = filtered.length

  return {
    mentioned,
    total,
    rate: total === 0 ? 0 : mentioned / total,
  }
}

/**
 * Calculate mention rate grouped by prompt or provider
 */
export function mentionRateBy(
  rows: AnalysisRow[],
  key: 'promptId' | 'provider'
): Record<string, { mentioned: number; total: number; rate: number }> {
  const grouped = new Map<string, AnalysisRow[]>()

  for (const row of rows) {
    if (row.brandMentioned === null) continue

    const k = key === 'promptId' ? row.promptId : row.provider
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(row)
  }

  const result: Record<string, { mentioned: number; total: number; rate: number }> = {}
  for (const [k, group] of grouped.entries()) {
    const mentioned = group.filter((r) => r.brandMentioned).length
    const total = group.length
    result[k] = {
      mentioned,
      total,
      rate: total === 0 ? 0 : mentioned / total,
    }
  }

  return result
}

/**
 * Calculate average rank (brand position) across rows where brandRank is non-null
 */
export function averageRank(rows: AnalysisRow[]): number | null {
  const ranks = rows.filter((r) => r.brandRank !== null).map((r) => r.brandRank!)

  if (ranks.length === 0) return null
  return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
}

/**
 * Calculate share of voice: mentions of brand vs each competitor
 * Sorted by mention count descending, then alphabetically; brand first on ties
 */
export function shareOfVoice(
  rows: AnalysisRow[],
  brandLabel: string
): { label: string; mentions: number; share: number }[] {
  const filtered = rows.filter((r) => r.brandMentioned !== null)
  if (filtered.length === 0) return []

  const mentions = new Map<string, number>()

  // Count brand mentions
  const brandCount = filtered.filter((r) => r.brandMentioned).length
  mentions.set(brandLabel, brandCount)

  // Count competitor mentions
  const compMentions = new Map<string, number>()
  for (const row of filtered) {
    for (const comp of row.competitorsMentioned) {
      compMentions.set(comp.label, (compMentions.get(comp.label) ?? 0) + 1)
    }
  }

  for (const [label, count] of compMentions.entries()) {
    mentions.set(label, count)
  }

  // Calculate total mentions
  const total = Array.from(mentions.values()).reduce((sum, count) => sum + count, 0)

  // Build result array: brand first, then sort competitors
  const result = Array.from(mentions.entries())
    .map(([label, count]) => ({
      label,
      mentions: count,
      share: total === 0 ? 0 : count / total,
    }))
    .sort((a, b) => {
      // Primary: brand always first
      if (a.label === brandLabel) return -1
      if (b.label === brandLabel) return 1
      // Secondary: descending by mentions (for competitors)
      if (a.mentions !== b.mentions) return b.mentions - a.mentions
      // Tertiary: alphabetically (for competitors)
      return a.label.localeCompare(b.label)
    })

  return result
}

/**
 * Extract top cited domains across all rows
 */
export function topCitedDomains(rows: AnalysisRow[], limit = 10): { domain: string; count: number }[] {
  const domainCounts = new Map<string, number>()

  for (const row of rows) {
    for (const domain of row.citationDomains) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
    }
  }

  return Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => {
      // Primary: descending by count
      if (a.count !== b.count) return b.count - a.count
      // Secondary: alphabetically
      return a.domain.localeCompare(b.domain)
    })
    .slice(0, limit)
}
