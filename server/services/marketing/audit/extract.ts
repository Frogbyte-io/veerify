import { Parser } from 'htmlparser2'

import type { PageFacts, PageImage } from './types'

/** Documents larger than this are truncated before parsing (characters). */
export const MAX_HTML_LENGTH = 2_000_000
/** Upper bounds on collected items so a pathological page cannot blow up memory. */
export const MAX_LINKS = 5_000
export const MAX_IMAGES = 2_000
export const MAX_JSON_LD_BLOCKS = 50
const MAX_JSON_LD_DEPTH = 8
const MAX_JSON_LD_LENGTH = 500_000

/** Elements whose text is never visible body text. */
const NON_VISIBLE = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'svg'])
const IGNORED_SCHEMES = /^(mailto|tel|javascript|data|sms|ftp|file):/i

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function nullIfEmpty(value: string | undefined | null): string | null {
  if (value == null) return null
  const v = collapse(value)
  return v === '' ? null : v
}

function safeUrl(raw: string, base: string): URL | null {
  try {
    return new URL(raw, base)
  } catch {
    return null
  }
}

function collectJsonLdTypes(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > MAX_JSON_LD_DEPTH || node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, into, depth + 1)
    return
  }
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  if (typeof type === 'string') into.add(type)
  else if (Array.isArray(type)) {
    for (const t of type) if (typeof t === 'string') into.add(t)
  }
  if ('@graph' in obj) collectJsonLdTypes(obj['@graph'], into, depth + 1)
}

/** Extracts the SEO-relevant facts from one page. Pure: no network, no DOM. */
export function extractPageFacts(url: string, statusCode: number, html: string): PageFacts {
  const source = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html

  let title: string | null = null
  let metaDescription: string | null = null
  let canonicalRaw: string | null = null
  const robotsMeta: string[] = []
  let lang: string | null = null
  const h1: string[] = []
  let ogTitle: string | null = null
  let ogDescription: string | null = null
  let ogImage: string | null = null
  let twitterCard: string | null = null
  let baseHref: string | null = null
  const rawLinks: string[] = []
  const images: PageImage[] = []
  const jsonLdTypes = new Set<string>()
  let jsonLdErrors = 0
  let jsonLdBlocks = 0
  let words = 0

  const stack: string[] = []
  let nonVisibleDepth = 0
  let titleBuf: string | null = null
  let h1Buf: string | null = null
  let jsonBuf: string | null = null

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        stack.push(name)
        if (NON_VISIBLE.has(name)) nonVisibleDepth++

        switch (name) {
          case 'html':
            if (lang === null) lang = nullIfEmpty(attrs.lang)
            break
          case 'title':
            if (title === null && titleBuf === null) titleBuf = ''
            break
          case 'base':
            if (baseHref === null && attrs.href) baseHref = attrs.href.trim()
            break
          case 'meta': {
            const key = (attrs.name || attrs.property || '').toLowerCase().trim()
            const content = attrs.content
            if (content === undefined) break
            if (key === 'description') metaDescription ??= nullIfEmpty(content)
            else if (key === 'robots') {
              const v = collapse(content).toLowerCase()
              if (v) robotsMeta.push(v)
            } else if (key === 'og:title') ogTitle ??= nullIfEmpty(content)
            else if (key === 'og:description') ogDescription ??= nullIfEmpty(content)
            else if (key === 'og:image') ogImage ??= nullIfEmpty(content)
            else if (key === 'twitter:card') twitterCard ??= nullIfEmpty(content)
            break
          }
          case 'link':
            if (
              canonicalRaw === null &&
              attrs.href &&
              (attrs.rel || '').toLowerCase().split(/\s+/).includes('canonical')
            ) {
              canonicalRaw = attrs.href.trim()
            }
            break
          case 'a':
            if (attrs.href !== undefined && rawLinks.length < MAX_LINKS) {
              rawLinks.push(attrs.href.trim())
            }
            break
          case 'img':
            if (images.length < MAX_IMAGES) {
              images.push({ src: attrs.src ?? '', alt: attrs.alt === undefined ? null : attrs.alt })
            }
            break
          case 'h1':
            h1Buf = ''
            break
          case 'script':
            if ((attrs.type || '').toLowerCase().trim() === 'application/ld+json') {
              jsonBuf = ''
            }
            break
        }
      },
      ontext(text) {
        if (titleBuf !== null) titleBuf += text
        if (jsonBuf !== null) {
          if (jsonBuf.length <= MAX_JSON_LD_LENGTH) jsonBuf += text
          return
        }
        if (nonVisibleDepth > 0) return
        if (h1Buf !== null) h1Buf += text
        const trimmed = text.trim()
        if (trimmed) words += trimmed.split(/\s+/).length
      },
      onclosetag(name) {
        const idx = stack.lastIndexOf(name)
        if (idx === -1) return
        // Pop everything opened inside the closing element (handles unclosed tags).
        while (stack.length > idx) {
          const popped = stack.pop() as string
          if (NON_VISIBLE.has(popped)) nonVisibleDepth--
        }
        if (name === 'title' && titleBuf !== null) {
          title = nullIfEmpty(titleBuf)
          titleBuf = null
        } else if (name === 'h1' && h1Buf !== null) {
          h1.push(collapse(h1Buf))
          h1Buf = null
        } else if (name === 'script' && jsonBuf !== null) {
          jsonLdBlocks++
          if (jsonLdBlocks <= MAX_JSON_LD_BLOCKS) {
            try {
              collectJsonLdTypes(JSON.parse(jsonBuf), jsonLdTypes)
            } catch {
              jsonLdErrors++
            }
          }
          jsonBuf = null
        }
      },
    },
    { decodeEntities: true }
  )
  parser.write(source)
  parser.end()

  // Resolve base: <base href> relative to the page URL, else the page URL itself.
  const pageUrl = safeUrl(url, url)
  const base = baseHref ? (safeUrl(baseHref, url)?.href ?? url) : url
  const pageOrigin = pageUrl?.origin ?? ''

  const internal = new Set<string>()
  const external = new Set<string>()
  for (const raw of rawLinks) {
    if (!raw || raw.startsWith('#') || IGNORED_SCHEMES.test(raw)) continue
    const resolved = safeUrl(raw, base)
    if (!resolved || (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')) continue
    resolved.hash = ''
    if (resolved.origin === pageOrigin) internal.add(resolved.href)
    else external.add(resolved.href)
  }

  let canonical: string | null = null
  if (canonicalRaw) {
    const resolved = safeUrl(canonicalRaw, base)
    canonical = resolved ? resolved.href : canonicalRaw
  }

  return {
    url,
    statusCode,
    title,
    metaDescription,
    canonical,
    robotsMeta: robotsMeta.length ? robotsMeta.join(', ') : null,
    lang,
    h1,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    internalLinks: [...internal],
    externalLinkCount: external.size,
    images,
    jsonLdTypes: [...jsonLdTypes],
    jsonLdErrors,
    wordCount: words,
  }
}
