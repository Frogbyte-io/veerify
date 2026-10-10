import { describe, expect, it } from 'vitest'

import { MAX_SITEMAP_URLS, parseSitemap } from '~/server/services/marketing/audit/sitemap'

describe('parseSitemap', () => {
  it('parses a urlset', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://e.com/</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>
    https://e.com/about
  </loc></url>
  <url><loc><![CDATA[https://e.com/a?b=1&c=2]]></loc></url>
  <url><loc>https://e.com/q?a=1&amp;b=2</loc></url>
</urlset>`
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      urls: ['https://e.com/', 'https://e.com/about', 'https://e.com/a?b=1&c=2', 'https://e.com/q?a=1&b=2'],
    })
  })

  it('parses a sitemap index', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://e.com/s1.xml</loc></sitemap><sitemap><loc>https://e.com/s2.xml</loc></sitemap></sitemapindex>`
    expect(parseSitemap(xml)).toEqual({
      kind: 'index',
      urls: ['https://e.com/s1.xml', 'https://e.com/s2.xml'],
    })
  })

  it('tolerates a BOM and namespace prefixes on loc-less entries', () => {
    expect(parseSitemap('﻿<urlset><url><loc>https://e.com/</loc></url><url></url></urlset>')).toEqual({
      kind: 'urlset',
      urls: ['https://e.com/'],
    })
  })

  it('marks HTML, empty and unrelated XML as invalid', () => {
    expect(parseSitemap('<html><body>Not found</body></html>')).toEqual({ kind: 'invalid', urls: [] })
    expect(parseSitemap('')).toEqual({ kind: 'invalid', urls: [] })
    expect(parseSitemap('<rss><channel><link>x</link></channel></rss>')).toEqual({
      kind: 'invalid',
      urls: [],
    })
    expect(parseSitemap('just text')).toEqual({ kind: 'invalid', urls: [] })
  })

  it('caps the number of URLs', () => {
    const entries = Array.from({ length: MAX_SITEMAP_URLS + 10 }, (_, i) => `<url><loc>https://e.com/${i}</loc></url>`)
    const r = parseSitemap(`<urlset>${entries.join('')}</urlset>`)
    expect(r.urls).toHaveLength(MAX_SITEMAP_URLS)
  })
})
