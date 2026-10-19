import { describe, expect, it } from 'vitest'
import { buildLlmsTxt } from '~/server/services/marketing/visibility/llms-txt'
import {
  buildSuggestionInput,
  normalizeSuggestions,
  pickSuggestionProvider,
} from '~/server/services/marketing/visibility/prompts'

describe('buildLlmsTxt', () => {
  it('builds name, summary and product links', () => {
    const out = buildLlmsTxt({
      name: 'Acme',
      description: 'Feedback\nfor teams.',
      origin: 'https://acme.com/',
      boardUrl: 'https://acme.veerify.io/acme',
      roadmapUrl: 'https://acme.veerify.io/acme/roadmap',
    })
    expect(out.startsWith('# Acme\n\n> Feedback for teams.\n\n## Product\n')).toBe(true)
    expect(out).toContain('- [Home](https://acme.com/)')
    expect(out).toContain('- [Feedback board](https://acme.veerify.io/acme)')
    expect(out).toContain('- [Roadmap](https://acme.veerify.io/acme/roadmap)')
    expect(out).not.toContain('## Docs')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('omits board and roadmap when not given', () => {
    const out = buildLlmsTxt({ name: 'Acme', description: null, origin: 'https://acme.com' })
    expect(out).not.toContain('Feedback board')
    expect(out).not.toContain('Roadmap')
  })

  it('lists at most 20 crawled pages, skipping the home page and duplicates', () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ url: `https://acme.com/p${i}`, title: `Page [${i}]` }))
    const out = buildLlmsTxt({
      name: 'Acme',
      description: 'x',
      origin: 'https://acme.com',
      pages: [{ url: 'https://acme.com/', title: 'Home' }, pages[0], ...pages],
    })
    expect(out).toContain('## Docs')
    expect(out.match(/^- \[Page \d+\]/gm)).toHaveLength(20)
    expect(out).toContain('- [Page 0](https://acme.com/p0)')
    expect(out).not.toContain('Page [')
    expect(out.match(/p0\)/g)).toHaveLength(1)
  })

  it('falls back to the path when a page has no title', () => {
    const out = buildLlmsTxt({
      name: 'Acme',
      description: 'x',
      origin: 'https://acme.com',
      pages: [{ url: 'https://acme.com/pricing', title: null }],
    })
    expect(out).toContain('- [/pricing](https://acme.com/pricing)')
  })
})

describe('prompt helpers', () => {
  it('prefers anthropic, then openai, ignoring invalid keys', () => {
    expect(
      pickSuggestionProvider([
        { provider: 'openai', status: 'valid' },
        { provider: 'anthropic', status: 'unchecked' },
      ])
    ).toBe('anthropic')
    expect(
      pickSuggestionProvider([
        { provider: 'openai', status: 'valid' },
        { provider: 'anthropic', status: 'invalid' },
      ])
    ).toBe('openai')
    expect(
      pickSuggestionProvider([
        { provider: 'perplexity', status: 'valid' },
        { provider: 'gemini', status: 'unchecked' },
        { provider: 'openai', status: 'invalid' },
      ])
    ).toBe('gemini')
    expect(pickSuggestionProvider([{ provider: 'perplexity', status: 'valid' }])).toBe('perplexity')
    expect(pickSuggestionProvider([{ provider: 'firecrawl', status: 'valid' }])).toBeNull()
  })

  it('normalizes suggestions: length, duplicates, product name, cap of 8', () => {
    const raw = [
      'too short',
      'What is the best tool for collecting feedback?',
      'what is the best tool for collecting feedback?',
      'Is Acme any good for small teams?',
      42,
      ...Array.from({ length: 12 }, (_, i) => `Alternative question number ${i} for a SaaS?`),
    ]
    const out = normalizeSuggestions(raw, ['Alternative question number 0 for a SaaS?'], 'Acme')
    expect(out[0]).toBe('What is the best tool for collecting feedback?')
    expect(out).toHaveLength(8)
    expect(out).not.toContain('Alternative question number 0 for a SaaS?')
    expect(out.some((t) => t.includes('Acme'))).toBe(false)
    expect(normalizeSuggestions('nope', [])).toEqual([])
  })

  it('sends only name, description and category names', () => {
    const input = buildSuggestionInput({ name: 'Acme', description: 'Tool', categoryNames: ['Bug', 'Idea'] })
    expect(input).toBe('Product name: Acme\nDescription: Tool\nFeedback categories: Bug, Idea')
  })
})
