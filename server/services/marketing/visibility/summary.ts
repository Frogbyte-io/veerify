/** Builds the AI visibility summary payload from stored answer rows. */

import { averageRank, mentionRate, mentionRateBy, shareOfVoice, topCitedDomains, type AnalysisRow } from './aggregate'

export interface SummaryAnswerRow {
  promptId: string
  provider: string
  brandMentioned: boolean | null
  brandRank: number | null
  competitorsMentioned: { termId?: string; label: string; rank?: number | null }[]
  citationDomains: string[]
}

export function toAnalysisRows(rows: SummaryAnswerRow[]): AnalysisRow[] {
  return rows.map((row) => ({
    promptId: row.promptId,
    provider: row.provider,
    brandMentioned: row.brandMentioned,
    brandRank: row.brandRank,
    competitorsMentioned: row.competitorsMentioned.map((c) => ({ termId: c.termId ?? c.label, label: c.label })),
    citationDomains: row.citationDomains,
  }))
}

export function buildVisibilitySummary(
  rows: SummaryAnswerRow[],
  options: { brandLabel: string; prompts: { id: string; text: string }[]; providers: string[] }
) {
  const analysis = toAnalysisRows(rows)
  const byProvider = mentionRateBy(analysis, 'provider')
  const byPrompt = mentionRateBy(analysis, 'promptId')

  const promptRows = options.prompts.map((prompt) => {
    const promptRowsOnly = analysis.filter((r) => r.promptId === prompt.id)
    const perProvider: Record<string, { mentioned: number; total: number; rate: number }> = {}
    for (const provider of options.providers) {
      const rate = mentionRate(promptRowsOnly.filter((r) => r.provider === provider))
      if (rate.total > 0) perProvider[provider] = rate
    }
    return {
      promptId: prompt.id,
      text: prompt.text,
      overall: byPrompt[prompt.id] ?? { mentioned: 0, total: 0, rate: 0 },
      byProvider: perProvider,
    }
  })

  return {
    overall: mentionRate(analysis),
    byProvider,
    prompts: promptRows,
    averageRank: averageRank(analysis),
    shareOfVoice: shareOfVoice(analysis, options.brandLabel),
    topCitedDomains: topCitedDomains(analysis, 10),
  }
}
