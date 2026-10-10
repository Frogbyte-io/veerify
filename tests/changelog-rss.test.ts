import { describe, expect, it } from 'vitest'
import { buildRssFeed, decodeBasicEntities, escapeXml } from '~/server/services/changelog/rss'

describe('escapeXml', () => {
  it('escapes the five XML special characters and strips illegal control chars', () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>\u0001`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;'
    )
  })
})

describe('decodeBasicEntities', () => {
  it('decodes entities left by markdownToPlainText', () => {
    expect(decodeBasicEntities('Fish &amp; chips &lt;3 &quot;x&quot; &#39;y&#39;')).toBe(`Fish & chips <3 "x" 'y'`)
  })
})

describe('buildRssFeed', () => {
  const feed = buildRssFeed({
    title: 'Acme & Co <changelog>',
    link: 'https://acme.example.com/changelog?a=1&b=2',
    description: 'Notes',
    selfUrl: 'https://x.test/feed.rss',
    items: [
      {
        title: 'Faster "search" </title><evil>',
        link: 'https://acme.example.com/changelog/faster',
        guid: 'g1',
        pubDate: new Date('2026-10-01T12:00:00Z'),
        description: 'Now 2x faster & <b>better</b>',
        categories: ['new', 'improved'],
      },
    ],
  })

  it('is well-formed RSS 2.0 with escaped content', () => {
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(feed).toContain('<rss version="2.0"')
    expect(feed).toContain('<title>Acme &amp; Co &lt;changelog&gt;</title>')
    expect(feed).toContain('https://acme.example.com/changelog?a=1&amp;b=2')
    expect(feed).toContain('<title>Faster &quot;search&quot; &lt;/title&gt;&lt;evil&gt;</title>')
    expect(feed).toContain('<description>Now 2x faster &amp; &lt;b&gt;better&lt;/b&gt;</description>')
    expect(feed).not.toContain('<evil>')
    expect(feed).toContain('<category>new</category>')
    expect(feed).toContain('<pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate>')
  })

  it('renders an empty channel without items', () => {
    const empty = buildRssFeed({ title: 't', link: 'l', description: 'd', selfUrl: 's', items: [] })
    expect(empty).toContain('<channel>')
    expect(empty).not.toContain('<item>')
  })
})
