import { describe, it, expect } from 'vitest'
import {
  findTermMentions,
  citationDomains,
  EXTRACTION_SCHEMA,
  buildExtractionSystemPrompt,
  buildAnalysis,
} from '~/server/services/marketing/visibility/analysis'
import {
  mentionRate,
  mentionRateBy,
  averageRank,
  shareOfVoice,
  topCitedDomains,
  type AnalysisRow,
} from '~/server/services/marketing/visibility/aggregate'
import type { MarketingTermInput, AnswerExtraction } from '~/server/services/marketing/visibility/types'
import type { LlmCitation } from '~/server/services/llm/types'

describe('findTermMentions', () => {
  it('finds exact term matches', () => {
    const text = 'Veerify is a feedback tool'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 1 }])
  })

  it('matches with possessive apostrophe', () => {
    const text = "Veerify's features are great"
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 1 }])
  })

  it('matches with markdown bold', () => {
    const text = 'Use **Veerify** for feedback'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 6, count: 1 }])
  })

  it('matches with trailing period', () => {
    const text = 'Veerify. is a tool'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 1 }])
  })

  it('does not match partial words like Veerifying', () => {
    const text = 'We are Veerifying the system'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([])
  })

  it('does not match prefixed words like unveerify', () => {
    const text = 'unveerify the changes'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([])
  })

  it('counts multiple mentions', () => {
    const text = 'Veerify is great. Veerify has features.'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 2 }])
  })

  it('matches aliases', () => {
    const text = 'We use VeeReview for feedback'
    const terms: MarketingTermInput[] = [
      {
        id: 'brand-1',
        kind: 'brand',
        label: 'Veerify',
        aliases: ['VeeReview'],
      },
    ]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 7, count: 1 }])
  })

  it('ignores empty aliases', () => {
    const text = 'Veerify is great'
    const terms: MarketingTermInput[] = [
      {
        id: 'brand-1',
        kind: 'brand',
        label: 'Veerify',
        aliases: ['', 'VeeReview'],
      },
    ]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 1 }])
  })

  it('returns only matched terms', () => {
    const text = 'Veerify is great'
    const terms: MarketingTermInput[] = [
      { id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] },
      { id: 'comp-1', kind: 'competitor', label: 'Competitor', aliases: [] },
    ]
    const result = findTermMentions(text, terms)
    expect(result).toHaveLength(1)
    expect(result[0].termId).toBe('brand-1')
  })

  it('sorts results by firstIndex', () => {
    const text = 'Competitor is okay. Veerify is better.'
    const terms: MarketingTermInput[] = [
      { id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] },
      { id: 'comp-1', kind: 'competitor', label: 'Competitor', aliases: [] },
    ]
    const result = findTermMentions(text, terms)
    expect(result[0].termId).toBe('comp-1')
    expect(result[1].termId).toBe('brand-1')
  })

  it('is case-insensitive', () => {
    const text = 'VEERIFY is great, veerify is great'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'brand-1', kind: 'brand', firstIndex: 0, count: 2 }])
  })

  it('handles multi-word terms', () => {
    const text = 'Slack is popular. Slack App is powerful.'
    const terms: MarketingTermInput[] = [{ id: 'comp-1', kind: 'competitor', label: 'Slack App', aliases: [] }]
    const result = findTermMentions(text, terms)
    expect(result).toEqual([{ termId: 'comp-1', kind: 'competitor', firstIndex: 18, count: 1 }])
  })
})

describe('citationDomains', () => {
  it('extracts domains from URLs', () => {
    const citations: LlmCitation[] = [{ url: 'https://example.com/path' }, { url: 'https://other.com/page' }]
    const result = citationDomains(citations)
    expect(result).toEqual(['example.com', 'other.com'])
  })

  it('removes www prefix', () => {
    const citations: LlmCitation[] = [{ url: 'https://www.example.com' }]
    const result = citationDomains(citations)
    expect(result).toEqual(['example.com'])
  })

  it('lowercases hostnames', () => {
    const citations: LlmCitation[] = [{ url: 'https://EXAMPLE.COM' }]
    const result = citationDomains(citations)
    expect(result).toEqual(['example.com'])
  })

  it('deduplicates domains', () => {
    const citations: LlmCitation[] = [{ url: 'https://example.com/page1' }, { url: 'https://example.com/page2' }]
    const result = citationDomains(citations)
    expect(result).toEqual(['example.com'])
  })

  it('preserves order of first occurrence', () => {
    const citations: LlmCitation[] = [
      { url: 'https://second.com' },
      { url: 'https://first.com' },
      { url: 'https://second.com' },
    ]
    const result = citationDomains(citations)
    expect(result).toEqual(['second.com', 'first.com'])
  })

  it('skips invalid URLs', () => {
    const citations: LlmCitation[] = [
      { url: 'https://example.com' },
      { url: 'not a url' },
      { url: 'https://other.com' },
    ]
    const result = citationDomains(citations)
    expect(result).toEqual(['example.com', 'other.com'])
  })

  it('handles www. prefix with subdomain', () => {
    const citations: LlmCitation[] = [{ url: 'https://www.sub.example.com' }]
    const result = citationDomains(citations)
    expect(result).toEqual(['sub.example.com'])
  })
})

describe('EXTRACTION_SCHEMA', () => {
  it('has correct structure for strict outputs', () => {
    expect(EXTRACTION_SCHEMA.type).toBe('object')
    expect(EXTRACTION_SCHEMA.additionalProperties).toBe(false)
    expect(EXTRACTION_SCHEMA.required).toContain('recommended')
    expect(EXTRACTION_SCHEMA.required).toContain('brandSentiment')
  })

  it('has recommended as array of strings', () => {
    const props = EXTRACTION_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.recommended.type).toBe('array')
    expect((props.recommended as Record<string, unknown>).items).toHaveProperty('type', 'string')
  })

  it('has brandSentiment as nullable enum', () => {
    const props = EXTRACTION_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.brandSentiment.type).toEqual(['string', 'null'])
    expect((props.brandSentiment as Record<string, unknown>).enum).toContain('positive')
    expect((props.brandSentiment as Record<string, unknown>).enum).toContain('neutral')
    expect((props.brandSentiment as Record<string, unknown>).enum).toContain('negative')
    expect((props.brandSentiment as Record<string, unknown>).enum).toContain(null)
  })
})

describe('buildExtractionSystemPrompt', () => {
  it('includes brand label in prompt', () => {
    const prompt = buildExtractionSystemPrompt('Veerify')
    expect(prompt).toContain('Veerify')
  })

  it('mentions sentiment levels', () => {
    const prompt = buildExtractionSystemPrompt('Veerify')
    expect(prompt).toContain('positive')
    expect(prompt).toContain('neutral')
    expect(prompt).toContain('negative')
  })

  it('mentions recommended products', () => {
    const prompt = buildExtractionSystemPrompt('Veerify')
    expect(prompt).toContain('recommended')
  })
})

describe('buildAnalysis', () => {
  it('detects brand mentioned', () => {
    const text = 'Veerify is great'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const analysis = buildAnalysis(text, [], terms, null)
    expect(analysis.brandMentioned).toBe(true)
  })

  it('detects brand not mentioned', () => {
    const text = 'Competitor is great'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const analysis = buildAnalysis(text, [], terms, null)
    expect(analysis.brandMentioned).toBe(false)
    expect(analysis.brandRank).toBeNull()
  })

  it('extracts brand rank from extraction', () => {
    const text = 'Veerify is mentioned'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const extraction: AnswerExtraction = {
      recommended: ['Veerify', 'Competitor'],
      brandSentiment: 'positive',
    }
    const analysis = buildAnalysis(text, [], terms, extraction)
    expect(analysis.brandRank).toBe(1)
  })

  it('extracts brand sentiment from extraction', () => {
    const text = 'Veerify is mentioned'
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const extraction: AnswerExtraction = {
      recommended: ['Veerify'],
      brandSentiment: 'positive',
    }
    const analysis = buildAnalysis(text, [], terms, extraction)
    expect(analysis.brandSentiment).toBe('positive')
  })

  it('lists mentioned competitors', () => {
    const text = 'Veerify and Competitor are tools'
    const terms: MarketingTermInput[] = [
      { id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] },
      { id: 'comp-1', kind: 'competitor', label: 'Competitor', aliases: [] },
    ]
    const analysis = buildAnalysis(text, [], terms, null)
    expect(analysis.competitorsMentioned).toHaveLength(1)
    expect(analysis.competitorsMentioned[0].label).toBe('Competitor')
  })

  it('extracts citation domains', () => {
    const text = 'Veerify'
    const citations: LlmCitation[] = [{ url: 'https://www.example.com' }]
    const terms: MarketingTermInput[] = [{ id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] }]
    const analysis = buildAnalysis(text, citations, terms, null)
    expect(analysis.citationDomains).toEqual(['example.com'])
  })

  it('falls back to mention order when extraction is null', () => {
    const text = 'Competitor is good. Veerify is better.'
    const terms: MarketingTermInput[] = [
      { id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] },
      { id: 'comp-1', kind: 'competitor', label: 'Competitor', aliases: [] },
    ]
    const analysis = buildAnalysis(text, [], terms, null)
    expect(analysis.brandRank).toBe(2)
  })

  it('handles extraction with competitor rank', () => {
    const text = 'Veerify and Competitor'
    const terms: MarketingTermInput[] = [
      { id: 'brand-1', kind: 'brand', label: 'Veerify', aliases: [] },
      { id: 'comp-1', kind: 'competitor', label: 'Competitor', aliases: [] },
    ]
    const extraction: AnswerExtraction = {
      recommended: ['Competitor', 'Veerify'],
      brandSentiment: null,
    }
    const analysis = buildAnalysis(text, [], terms, extraction)
    expect(analysis.competitorsMentioned[0].rank).toBe(1)
  })
})

describe('mentionRate', () => {
  it('calculates mention rate', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = mentionRate(rows)
    expect(result.mentioned).toBe(1)
    expect(result.total).toBe(2)
    expect(result.rate).toBe(0.5)
  })

  it('ignores null brandMentioned', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: null,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = mentionRate(rows)
    expect(result.total).toBe(1)
    expect(result.rate).toBe(1)
  })

  it('returns rate 0 for zero rows', () => {
    const result = mentionRate([])
    expect(result.rate).toBe(0)
    expect(result.total).toBe(0)
  })
})

describe('mentionRateBy', () => {
  it('groups by promptId', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p2',
        provider: 'anthropic',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = mentionRateBy(rows, 'promptId')
    expect(result.p1.rate).toBe(1)
    expect(result.p2.rate).toBe(0)
  })

  it('groups by provider', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'openai',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = mentionRateBy(rows, 'provider')
    expect(result.anthropic.rate).toBe(1)
    expect(result.openai.rate).toBe(0)
  })
})

describe('averageRank', () => {
  it('calculates average rank', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: 1,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: 3,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = averageRank(rows)
    expect(result).toBe(2)
  })

  it('ignores null ranks', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: 2,
        competitorsMentioned: [],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = averageRank(rows)
    expect(result).toBe(2)
  })

  it('returns null for no ranks', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = averageRank(rows)
    expect(result).toBeNull()
  })
})

describe('shareOfVoice', () => {
  it('calculates share of voice', () => {
    const brandLabel = 'Veerify'
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [{ termId: 'c1', label: 'Competitor' }],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: [],
      },
    ]
    const result = shareOfVoice(rows, brandLabel)
    expect(result[0].label).toBe('Veerify')
    expect(result[0].mentions).toBe(2)
    expect(result[0].share).toBe(2 / 3)
  })

  it('brands listed first on ties', () => {
    const brandLabel = 'Veerify'
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [{ termId: 'c1', label: 'Other' }],
        citationDomains: [],
      },
    ]
    const result = shareOfVoice(rows, brandLabel)
    const veerifyIndex = result.findIndex((r) => r.label === 'Veerify')
    const otherIndex = result.findIndex((r) => r.label === 'Other')
    expect(veerifyIndex).toBeLessThan(otherIndex)
  })

  it('sorts by mentions descending, then alphabetically', () => {
    const brandLabel = 'Veerify'
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [
          { termId: 'c1', label: 'Zebra' },
          { termId: 'c2', label: 'Apple' },
        ],
        citationDomains: [],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: false,
        brandRank: null,
        competitorsMentioned: [{ termId: 'c2', label: 'Apple' }],
        citationDomains: [],
      },
    ]
    const result = shareOfVoice(rows, brandLabel)
    expect(result[0].label).toBe('Veerify')
    expect(result[1].label).toBe('Apple')
    expect(result[2].label).toBe('Zebra')
  })

  it('returns empty for no rows', () => {
    const result = shareOfVoice([], 'Veerify')
    expect(result).toEqual([])
  })
})

describe('topCitedDomains', () => {
  it('returns top domains by count', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: ['example.com', 'other.com'],
      },
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: ['example.com'],
      },
    ]
    const result = topCitedDomains(rows, 10)
    expect(result[0].domain).toBe('example.com')
    expect(result[0].count).toBe(2)
    expect(result[1].domain).toBe('other.com')
    expect(result[1].count).toBe(1)
  })

  it('limits results', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: ['a.com', 'b.com', 'c.com', 'd.com'],
      },
    ]
    const result = topCitedDomains(rows, 2)
    expect(result).toHaveLength(2)
  })

  it('sorts by count desc then alphabetically', () => {
    const rows: AnalysisRow[] = [
      {
        promptId: 'p1',
        provider: 'anthropic',
        brandMentioned: true,
        brandRank: null,
        competitorsMentioned: [],
        citationDomains: ['zebra.com', 'apple.com'],
      },
    ]
    const result = topCitedDomains(rows, 10)
    expect(result[0].domain).toBe('apple.com')
    expect(result[1].domain).toBe('zebra.com')
  })
})

describe('buildAnalysis extraction hardening', () => {
  const terms: MarketingTermInput[] = [
    { id: 'b', kind: 'brand', label: 'Veerify', aliases: ['vf', 'Veerify App'] },
    { id: 'c', kind: 'competitor', label: 'Acme', aliases: [] },
  ]
  const text = 'Acme is good, and Veerify too. vf is short.'

  it('treats a malformed extraction as null (falls back to mention order)', () => {
    const bad = { recommended: 'Veerify', brandSentiment: 'ecstatic' }
    const out = buildAnalysis(text, [], terms, bad as never)
    expect(out.brandRank).toBe(2)
    expect(out.brandSentiment).toBeNull()
  })

  it('rejects oversized or empty names and too many entries', () => {
    expect(
      buildAnalysis(text, [], terms, { recommended: ['x'.repeat(101)], brandSentiment: null } as never).brandRank
    ).toBe(2)
    expect(
      buildAnalysis(text, [], terms, { recommended: Array(31).fill('Veerify'), brandSentiment: 'positive' } as never)
        .brandSentiment
    ).toBeNull()
  })

  it('does not match tiny recommended names by substring', () => {
    // "e" is inside "Veerify" and "Acme" but must not rank anything
    const out = buildAnalysis(text, [], terms, { recommended: ['e', 'Veerify'], brandSentiment: null })
    expect(out.brandRank).toBe(2)
    expect(out.competitorsMentioned[0].rank).toBe(1) // fallback mention order, not the "e" entry
  })

  it('ignores aliases shorter than 3 chars when matching recommendations', () => {
    const out = buildAnalysis(text, [], terms, {
      recommended: ['Zed', 'vf', 'Other', 'Veerify App'],
      brandSentiment: null,
    })
    expect(out.brandRank).toBe(4)
  })

  it('still accepts a valid extraction', () => {
    const out = buildAnalysis(text, [], terms, { recommended: ['Veerify', 'Acme'], brandSentiment: 'positive' })
    expect(out.brandRank).toBe(1)
    expect(out.competitorsMentioned[0].rank).toBe(2)
    expect(out.brandSentiment).toBe('positive')
  })
})
