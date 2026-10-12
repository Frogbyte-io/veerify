import { describe, expect, it } from 'vitest'

import { extractPageFacts, MAX_HTML_LENGTH } from '~/server/services/marketing/audit/extract'

const URL_ = 'https://example.com/blog/post'

const FULL = `<!doctype html>
<html lang="en">
<head>
  <title>  Great   Post | Example </title>
  <meta name="description" content="A very useful description of the post.">
  <meta name="robots" content="NoIndex, Follow">
  <link rel="canonical" href="/blog/post">
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Desc">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Ex"}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Article","BlogPosting"]}]}</script>
  <script type="application/ld+json">{ not json </script>
  <style>.a { color: red }</style>
</head>
<body>
  <h1>Hello <em>world</em></h1>
  <p>One two three four.</p>
  <script>var words = "ignored ignored ignored"</script>
  <noscript>hidden hidden</noscript>
  <a href="/about#team">About</a>
  <a href="/about">About again</a>
  <a href="pricing">Pricing</a>
  <a href="https://example.com/x?y=1#z">X</a>
  <a href="https://other.com/">Other</a>
  <a href="https://other.com/">Other dup</a>
  <a href="mailto:a@b.c">mail</a>
  <a href="tel:+123">tel</a>
  <a href="javascript:void(0)">js</a>
  <a href="#top">top</a>
  <img src="/a.png" alt="A">
  <img src="/b.png">
  <img src="/c.png" alt="">
</body></html>`

describe('extractPageFacts', () => {
  const facts = extractPageFacts(URL_, 200, FULL)

  it('extracts head metadata', () => {
    expect(facts.url).toBe(URL_)
    expect(facts.statusCode).toBe(200)
    expect(facts.title).toBe('Great Post | Example')
    expect(facts.metaDescription).toBe('A very useful description of the post.')
    expect(facts.robotsMeta).toBe('noindex, follow')
    expect(facts.canonical).toBe('https://example.com/blog/post')
    expect(facts.lang).toBe('en')
    expect(facts.ogTitle).toBe('OG Title')
    expect(facts.ogDescription).toBe('OG Desc')
    expect(facts.ogImage).toBe('https://example.com/og.png')
    expect(facts.twitterCard).toBe('summary_large_image')
  })

  it('extracts h1 text across nested elements', () => {
    expect(facts.h1).toEqual(['Hello world'])
  })

  it('resolves, filters and dedupes links', () => {
    expect(facts.internalLinks.sort()).toEqual(
      ['https://example.com/about', 'https://example.com/blog/pricing', 'https://example.com/x?y=1'].sort()
    )
    expect(facts.externalLinkCount).toBe(1)
  })

  it('records images with null alt when the attribute is absent', () => {
    expect(facts.images).toEqual([
      { src: '/a.png', alt: 'A' },
      { src: '/b.png', alt: null },
      { src: '/c.png', alt: '' },
    ])
  })

  it('collects JSON-LD types from arrays and @graph and counts failures', () => {
    expect(facts.jsonLdTypes.sort()).toEqual(['Article', 'BlogPosting', 'Organization', 'WebSite'])
    expect(facts.jsonLdErrors).toBe(1)
  })

  it('counts only visible body words', () => {
    // "Hello world" (2) + "One two three four." (4) + link texts
    const f = extractPageFacts(
      URL_,
      200,
      '<html><head><title>T words</title></head><body><p>one two three</p><script>a b c d</script><style>x y</style><noscript>n m</noscript></body></html>'
    )
    expect(f.wordCount).toBe(3)
  })

  it('honours <base href>', () => {
    const f = extractPageFacts(
      'https://example.com/a/b',
      200,
      '<html><head><base href="/docs/"><link rel="canonical" href="intro"></head><body><a href="guide">g</a><a href="https://cdn.example.com/x">c</a></body></html>'
    )
    expect(f.internalLinks).toEqual(['https://example.com/docs/guide'])
    expect(f.externalLinkCount).toBe(1)
    expect(f.canonical).toBe('https://example.com/docs/intro')
  })

  it('treats a different subdomain or scheme as external', () => {
    const f = extractPageFacts(
      'https://example.com/',
      200,
      '<a href="https://www.example.com/">w</a><a href="http://example.com/">h</a>'
    )
    expect(f.internalLinks).toEqual([])
    expect(f.externalLinkCount).toBe(2)
  })

  it('returns nulls and empties for an empty document', () => {
    const f = extractPageFacts(URL_, 404, '')
    expect(f).toMatchObject({
      statusCode: 404,
      title: null,
      metaDescription: null,
      canonical: null,
      robotsMeta: null,
      lang: null,
      h1: [],
      internalLinks: [],
      images: [],
      jsonLdTypes: [],
      jsonLdErrors: 0,
      wordCount: 0,
    })
  })

  it('treats blank title and description as missing', () => {
    const f = extractPageFacts(
      URL_,
      200,
      '<html><head><title>  </title><meta name="description" content="  "></head></html>'
    )
    expect(f.title).toBeNull()
    expect(f.metaDescription).toBeNull()
  })

  it('decodes entities and tolerates malformed html', () => {
    const f = extractPageFacts(
      URL_,
      200,
      '<title>Tom &amp; Jerry</title><div><p>unclosed <b>bold <h1>Late heading</h1>'
    )
    expect(f.title).toBe('Tom & Jerry')
    expect(f.h1).toEqual(['Late heading'])
  })

  it('does not throw on huge documents and truncates them', () => {
    const body = '<p>word </p>'.repeat(Math.ceil(MAX_HTML_LENGTH / 12) + 1000)
    const f = extractPageFacts(URL_, 200, `<html><body>${body}</body></html>`)
    expect(f.wordCount).toBeGreaterThan(0)
    expect(f.wordCount).toBeLessThanOrEqual(Math.ceil(MAX_HTML_LENGTH / 12))
  })

  it('ignores invalid hrefs without throwing', () => {
    const f = extractPageFacts(URL_, 200, '<a href="http://">x</a><a href="">y</a><a>z</a>')
    expect(f.internalLinks).toEqual([])
  })
})
