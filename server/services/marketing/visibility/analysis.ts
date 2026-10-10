/** AI visibility analysis: deterministic term matching and structured extraction. */

import type { LlmCitation } from '~/server/services/llm/types'
import type { MarketingTermInput, TermMention, AnswerExtraction, AnswerAnalysis } from './types'

/**
 * Find mentions of marketing terms (brand, competitors, keywords) in text.
 * Case-insensitive, whole-word/phrase matching using unicode-aware word boundaries.
 *
 * Matches: "Veerify's", "**Veerify**", "Veerify." but NOT "Veerifying" or "unveerify"
 */
export function findTermMentions(text: string, terms: MarketingTermInput[]): TermMention[] {
  const results: TermMention[] = []

  for (const term of terms) {
    const searchTerms = [term.label, ...term.aliases.filter((a) => a.length > 0)]
    const matches: { index: number; termId: string; kind: typeof term.kind }[] = []

    for (const searchTerm of searchTerms) {
      // Build regex with unicode word boundaries
      // [\p{L}\p{N}] matches any letter or digit
      // Apostrophes are not word characters, so they don't break boundaries
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gui')

      let match
      while ((match = pattern.exec(text)) !== null) {
        matches.push({ index: match.index, termId: term.id, kind: term.kind })
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => a.index - b.index)
      const firstIndex = matches[0].index
      const count = matches.length

      results.push({
        termId: term.id,
        kind: term.kind,
        firstIndex,
        count,
      })
    }
  }

  results.sort((a, b) => a.firstIndex - b.firstIndex)
  return results
}

/**
 * Extract unique domains from citations, lowercase, with www prefix removed.
 * Preserves order, skips invalid URLs.
 */
export function citationDomains(citations: LlmCitation[]): string[] {
  const domains = new Set<string>()
  const orderedDomains: string[] = []

  for (const citation of citations) {
    try {
      const url = new URL(citation.url)
      let hostname = url.hostname.toLowerCase()

      // Remove leading www.
      if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4)
      }

      if (!domains.has(hostname)) {
        domains.add(hostname)
        orderedDomains.push(hostname)
      }
    } catch {
      // Skip invalid URLs
    }
  }

  return orderedDomains
}

/**
 * JSON Schema for AnswerExtraction, conforming to OpenAI strict structured output format.
 */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    recommended: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Products or tools the answer recommends, in order presented',
    },
    brandSentiment: {
      type: ['string', 'null'],
      enum: ['positive', 'neutral', 'negative', null],
      description: 'Sentiment towards the brand when mentioned, or null if not mentioned',
    },
  },
  required: ['recommended', 'brandSentiment'],
  additionalProperties: false,
}

/**
 * Build system prompt instructions for the LLM extraction step.
 * Instructs the model to list recommended products and give brand sentiment.
 */
export function buildExtractionSystemPrompt(brandLabel: string): string {
  return `You are analyzing an LLM answer to extract structured data.

List the products or tools the answer recommends in the order they are presented. Use normalized product names only (e.g., "Slack", "Notion", "GitHub").

Assess the sentiment of the answer towards the brand "${brandLabel}":
- "positive" if the answer speaks favorably of ${brandLabel}
- "neutral" if ${brandLabel} is mentioned factually or without sentiment
- "negative" if the answer criticizes or discourages ${brandLabel}
- null if ${brandLabel} is not mentioned at all

Return a JSON object with "recommended" (array of strings) and "brandSentiment" (string or null).`
}

/**
 * Build a complete analysis from answer text, citations, terms, and LLM extraction.
 *
 * If extraction is null, falls back to ranking based on first mention order in text.
 */
export function buildAnalysis(
  text: string,
  citations: LlmCitation[],
  terms: MarketingTermInput[],
  extraction: AnswerExtraction | null
): AnswerAnalysis {
  // Find all term mentions in the text
  const mentions = findTermMentions(text, terms)

  // Build maps for quick lookup
  const brandTerms = terms.filter((t) => t.kind === 'brand')
  const competitorTerms = terms.filter((t) => t.kind === 'competitor')

  const mentionMap = new Map(mentions.map((m) => [m.termId, m]))

  // Check if brand is mentioned
  const brandMentioned = brandTerms.some((t) => mentionMap.has(t.id))

  // Determine brand rank
  let brandRank: number | null = null
  if (extraction?.recommended && brandMentioned) {
    // Try to find brand in recommended list
    for (let i = 0; i < extraction.recommended.length; i++) {
      const recommended = extraction.recommended[i].toLowerCase().trim()
      for (const brandTerm of brandTerms) {
        const labelMatch =
          recommended === brandTerm.label.toLowerCase() ||
          brandTerm.label.toLowerCase().includes(recommended) ||
          recommended.includes(brandTerm.label.toLowerCase())
        const aliasMatch = brandTerm.aliases.some(
          (alias) =>
            recommended === alias.toLowerCase() ||
            alias.toLowerCase().includes(recommended) ||
            recommended.includes(alias.toLowerCase())
        )

        if (labelMatch || aliasMatch) {
          brandRank = i + 1
          break
        }
      }
      if (brandRank !== null) break
    }
  }

  // Fallback: use first mention order among all terms
  if (brandRank === null && brandMentioned) {
    const allMentioned = Array.from(mentionMap.entries()).sort((a, b) => a[1].firstIndex - b[1].firstIndex)
    const brandPosition = allMentioned.findIndex(([termId]) => brandTerms.some((t) => t.id === termId))
    if (brandPosition >= 0) {
      brandRank = brandPosition + 1
    }
  }

  // Determine competitor ranks
  const competitorsMentioned: { termId: string; label: string; rank: number | null }[] = []

  for (const compTerm of competitorTerms) {
    if (!mentionMap.has(compTerm.id)) continue

    let compRank: number | null = null

    if (extraction?.recommended) {
      // Try to find competitor in recommended list
      for (let i = 0; i < extraction.recommended.length; i++) {
        const recommended = extraction.recommended[i].toLowerCase().trim()
        const labelMatch =
          recommended === compTerm.label.toLowerCase() ||
          compTerm.label.toLowerCase().includes(recommended) ||
          recommended.includes(compTerm.label.toLowerCase())
        const aliasMatch = compTerm.aliases.some(
          (alias) =>
            recommended === alias.toLowerCase() ||
            alias.toLowerCase().includes(recommended) ||
            recommended.includes(alias.toLowerCase())
        )

        if (labelMatch || aliasMatch) {
          compRank = i + 1
          break
        }
      }
    }

    if (compRank === null && mentionMap.has(compTerm.id)) {
      // Fallback: based on mention order relative to all mentioned terms
      const allMentioned = Array.from(mentionMap.entries()).sort((a, b) => a[1].firstIndex - b[1].firstIndex)
      const position = allMentioned.findIndex(([termId]) => termId === compTerm.id)
      if (position >= 0) {
        compRank = position + 1
      }
    }

    competitorsMentioned.push({
      termId: compTerm.id,
      label: compTerm.label,
      rank: compRank,
    })
  }

  return {
    brandMentioned,
    brandRank,
    competitorsMentioned,
    citationDomains: citationDomains(citations),
    brandSentiment: extraction?.brandSentiment ?? null,
  }
}
