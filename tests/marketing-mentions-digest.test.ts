import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/lib/email', () => ({ sendMarketingMentionsDigestEmail: vi.fn() }))

const { marketingMentionsDigestTemplate } = await import('~/lib/email-templates')
const { sendMentionsDigests } = await import('~/server/services/marketing/mentions/digest')

const counts = { mention: 2, competitor: 1, opportunity: 0 }

describe('marketingMentionsDigestTemplate', () => {
  it('escapes post and product content in html', () => {
    const { html, subject } = marketingMentionsDigestTemplate({
      productName: '<b>Acme</b>',
      counts,
      mentionsUrl: 'https://app.test/marketing/mentions?product=a&b=1',
      items: [
        {
          sourceLabel: 'Hacker News',
          kind: 'mention',
          title: '<script>alert(1)</script>',
          excerpt: '"><img src=x onerror=alert(1)>',
          url: 'https://news.ycombinator.com/item?id=1&x="y"',
        },
      ],
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>Acme</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;b=1')
    expect(subject).toBe('3 new mentions for <b>Acme</b>')
  })

  it('does not link non-http urls', () => {
    const { html } = marketingMentionsDigestTemplate({
      productName: 'Acme',
      counts,
      mentionsUrl: 'https://app.test/m',
      items: [{ sourceLabel: 'Reddit', kind: 'opportunity', title: 'Hi', excerpt: '', url: 'javascript:alert(1)' }],
    })
    expect(html).not.toContain('javascript:')
  })

  it('includes counts, items and the inbox link in the text body', () => {
    const { text } = marketingMentionsDigestTemplate({
      productName: 'Acme',
      counts,
      mentionsUrl: 'https://app.test/marketing/mentions?product=acme',
      items: [{ sourceLabel: 'Bluesky', kind: 'mention', title: null, excerpt: 'Loving Acme', url: 'https://b.sky/1' }],
    })
    expect(text).toContain('2 brand mentions')
    expect(text).toContain('[Bluesky] Loving Acme')
    expect(text).toContain('https://app.test/marketing/mentions?product=acme')
  })
})
