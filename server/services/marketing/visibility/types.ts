/** AI visibility analysis contract. */

export type MarketingTermKind = 'brand' | 'competitor' | 'keyword'

export interface MarketingTermInput {
  id: string
  kind: MarketingTermKind
  label: string
  aliases: string[]
}

export interface TermMention {
  termId: string
  kind: MarketingTermKind
  /** Character index of the first match in the answer */
  firstIndex: number
  count: number
}

/** Output of the LLM extraction step (JSON schema in `analysis.ts`) */
export interface AnswerExtraction {
  /** Products/tools the answer recommends, in the order presented */
  recommended: string[]
  /** Sentiment towards the brand, when the brand is mentioned */
  brandSentiment: 'positive' | 'neutral' | 'negative' | null
}

export interface AnswerAnalysis {
  brandMentioned: boolean
  /** 1-based position of the brand among recommended products; null if absent */
  brandRank: number | null
  competitorsMentioned: { termId: string; label: string; rank: number | null }[]
  citationDomains: string[]
  brandSentiment: AnswerExtraction['brandSentiment']
}
