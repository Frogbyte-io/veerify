import { describe, expect, it } from 'vitest'
import { detectKeyProviders, PROVIDER_KEY_LINKS } from '../lib/api-key-detect'

describe('detectKeyProviders', () => {
  it('recognizes each provider by prefix', () => {
    expect(detectKeyProviders('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toEqual(['anthropic'])
    expect(detectKeyProviders('sk-proj-abcdefghijklmnopqrstuvwxyz0123')).toEqual(['openai'])
    expect(detectKeyProviders('sk-abcdefghijklmnopqrstuvwxyz0123')).toEqual(['openai'])
    expect(detectKeyProviders('pplx-abcdefghijklmnop')).toEqual(['perplexity'])
    expect(detectKeyProviders('fc-0123456789abcdef')).toEqual(['firecrawl'])
  })

  it('treats Google keys as either Gemini or PageSpeed', () => {
    expect(detectKeyProviders('AIzaSyA-0123456789abcdefghijklmnopqrs')).toEqual(['gemini', 'pagespeed'])
  })

  it('never files an Anthropic key under OpenAI, and trims whitespace', () => {
    expect(detectKeyProviders('  sk-ant-admin01-abcdefghijklmnopqrstuvwxyz \n')).toEqual(['anthropic'])
  })

  it('returns nothing for unknown or empty input', () => {
    expect(detectKeyProviders('')).toEqual([])
    expect(detectKeyProviders('hello world')).toEqual([])
    expect(detectKeyProviders('sk-short')).toEqual([])
  })

  it('has a key link for every detectable provider', () => {
    for (const provider of ['anthropic', 'openai', 'gemini', 'perplexity', 'firecrawl', 'pagespeed'] as const) {
      expect(PROVIDER_KEY_LINKS[provider].url).toMatch(/^https:\/\//)
    }
  })
})
