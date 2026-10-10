import { describe, expect, it } from 'vitest'
import { buildQueries, classifyMention, matchTerms } from '../server/services/social-sources/match'
import type { SocialPost } from '../server/services/social-sources/types'

function post(text: string, title: string | null = null): SocialPost {
  return {
    source: 'hackernews',
    externalId: '1',
    url: 'https://news.ycombinator.com/item?id=1',
    author: null,
    title,
    text,
    publishedAt: new Date(),
    score: null,
  }
}

const brand = { id: 'b', kind: 'brand' as const, label: 'Veerify', aliases: ['veerify.com', 'vf'] }
const comp = { id: 'c', kind: 'competitor' as const, label: 'Canny', aliases: [] }
const kw = { id: 'k', kind: 'keyword' as const, label: 'feedback tool', aliases: [] }

describe('matchTerms', () => {
  it('matches case-insensitively with possessives and punctuation', () => {
    expect(matchTerms(post("Veerify's roadmap is nice"), [brand])).toEqual([{ termId: 'b', kind: 'brand' }])
    expect(matchTerms(post('try (VEERIFY), it is good.'), [brand])).toHaveLength(1)
    expect(matchTerms(post('a veerify-based setup'), [brand])).toHaveLength(1)
    expect(matchTerms(post('curly Veerify’s'), [brand])).toHaveLength(1)
  })

  it('does not match inside other words', () => {
    expect(matchTerms(post('Veerifying things, unveerify'), [brand])).toEqual([])
  })

  it('matches phrases across whitespace and in the title', () => {
    expect(matchTerms(post('x', 'Best feedback   tool?'), [kw])).toHaveLength(1)
  })

  it('handles unicode letters', () => {
    const t = { id: 'u', kind: 'keyword' as const, label: 'café', aliases: [] }
    expect(matchTerms(post('Nice café here'), [t])).toHaveLength(1)
    expect(matchTerms(post('cafés'), [t])).toEqual([])
    expect(matchTerms(post('Ångström'), [{ ...t, label: 'ångström' }])).toHaveLength(1)
  })

  it('ignores short aliases and escapes regex characters', () => {
    expect(matchTerms(post('we use vf daily'), [brand])).toEqual([])
    const t = { id: 'x', kind: 'keyword' as const, label: 'C++ (lang)', aliases: [] }
    expect(matchTerms(post('I like C++ (lang) a lot'), [t])).toHaveLength(1)
  })

  it('matches aliases', () => {
    expect(matchTerms(post('see veerify.com for more'), [brand])).toHaveLength(1)
  })
})

describe('classifyMention', () => {
  it('prioritises brand > competitor > keyword', () => {
    expect(classifyMention([{ kind: 'keyword' }, { kind: 'competitor' }, { kind: 'brand' }])).toBe('mention')
    expect(classifyMention([{ kind: 'keyword' }, { kind: 'competitor' }])).toBe('competitor')
    expect(classifyMention([{ kind: 'keyword' }])).toBe('opportunity')
    expect(classifyMention([])).toBeNull()
  })
})

describe('buildQueries', () => {
  it('dedupes, skips short aliases, keeps term attribution', () => {
    const q = buildQueries([
      brand,
      { ...comp, aliases: ['CANNY', 'ca', 'Canny'] },
      { id: 'k2', kind: 'keyword', label: 'canny', aliases: [] },
    ])
    expect(q.map((x) => x.query)).toEqual(['Veerify', 'veerify.com', 'Canny'])
    expect(q[2].termIds).toEqual(['c', 'k2'])
  })
})
