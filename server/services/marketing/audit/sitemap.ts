import { Parser } from 'htmlparser2'

export const MAX_SITEMAP_URLS = 50_000

export interface ParsedSitemap {
  /** `index` means the URLs are child sitemaps, not pages */
  kind: 'urlset' | 'index' | 'invalid'
  urls: string[]
}

/** Tolerant sitemap parser: reads `<loc>` values of a urlset or sitemapindex. */
export function parseSitemap(xml: string): ParsedSitemap {
  let root: string | null = null
  let inLoc = false
  let buf = ''
  const urls: string[] = []

  const parser = new Parser(
    {
      onopentag(name) {
        const n = name.toLowerCase()
        if (root === null) root = n
        if (n === 'loc') {
          inLoc = true
          buf = ''
        }
      },
      ontext(text) {
        if (inLoc) buf += text
      },
      onclosetag(name) {
        if (name.toLowerCase() === 'loc' && inLoc) {
          inLoc = false
          const loc = buf.trim()
          if (loc && urls.length < MAX_SITEMAP_URLS) urls.push(loc)
        }
      },
    },
    { xmlMode: true }
  )
  try {
    parser.write(xml.replace(/^\uFEFF/, ''))
    parser.end()
  } catch {
    return { kind: 'invalid', urls: [] }
  }

  if (root === 'urlset') return { kind: 'urlset', urls }
  if (root === 'sitemapindex') return { kind: 'index', urls }
  return { kind: 'invalid', urls: [] }
}
