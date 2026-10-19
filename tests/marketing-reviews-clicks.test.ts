import { describe, expect, it } from 'vitest'
import { isLikelyHumanClick } from '~/server/services/marketing/reviews/guards'

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

describe('isLikelyHumanClick', () => {
  it('counts a browser GET', () => {
    expect(isLikelyHumanClick('GET', CHROME)).toBe(true)
  })

  it('ignores HEAD and empty user agents', () => {
    expect(isLikelyHumanClick('HEAD', CHROME)).toBe(false)
    expect(isLikelyHumanClick('GET', '')).toBe(false)
    expect(isLikelyHumanClick('GET', undefined)).toBe(false)
  })

  it.each([
    'Googlebot/2.1',
    'Slackbot-LinkExpanding 1.0',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; Proofpoint)',
    'Microsoft Office SafeLinks Protection',
    'curl/8.4.0',
    'python-requests/2.31',
    'okhttp/4.12.0',
    'Mimecast Link Checker',
    'WhatsApp link preview',
  ])('ignores scanner %s', (ua) => {
    expect(isLikelyHumanClick('GET', ua)).toBe(false)
  })
})
