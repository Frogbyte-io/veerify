import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

/**
 * Maximum input length cap (100KB) to prevent unbounded processing.
 */
const MAX_INPUT_LENGTH = 100_000

/**
 * Sanitization policy for rendered markdown HTML.
 *
 * Allows common markdown elements (headings, lists, emphasis, links, code,
 * blockquotes, tables) with a strict allowlist and XSS mitigation.
 */
const MARKDOWN_POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2',
    'h3',
    'h4',
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
  ],

  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
  },

  // http/https/mailto only — stops javascript:, data:, vbscript:
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],

  // Reject protocol-relative URLs
  allowProtocolRelative: false,

  // Drop contents of removed elements (prevent exposed <script> source)
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],

  transformTags: {
    // Demote h1 to h2
    h1: (tagName, attribs) => {
      return { tagName: 'h2', attribs }
    },

    // Secure links: add target + rel, validate href
    a: (tagName, attribs) => {
      const href = (attribs.href ?? '').trim()

      // Only allow absolute safe URLs (http://, https://, mailto:)
      const isAbsoluteSafe = /^(https?:|mailto:)/i.test(href)
      if (!isAbsoluteSafe) {
        // Drop link but keep title
        const kept: Record<string, string> = {}
        if (attribs.title) kept.title = attribs.title
        return { tagName, attribs: kept }
      }

      const attribsOut: Record<string, string> = { href }
      if (attribs.title) attribsOut.title = attribs.title
      attribsOut.target = '_blank'
      attribsOut.rel = 'noopener noreferrer nofollow'
      return { tagName, attribs: attribsOut }
    },

    // Secure images: https-only src
    img: (tagName, attribs) => {
      const src = (attribs.src ?? '').trim()

      // Only allow https:// images
      if (!/^https:\/\//i.test(src)) {
        return { tagName: '', attribs: {} }
      }

      const kept: Record<string, string> = { src }
      if (attribs.alt) kept.alt = attribs.alt
      if (attribs.title) kept.title = attribs.title
      return { tagName, attribs: kept }
    },
  },
}

/**
 * Convert markdown source to sanitized HTML.
 *
 * Features:
 * - GFM: headings (h1 → h2), lists, emphasis, links, inline code, fenced code blocks, blockquotes, tables
 * - Sanitization: XSS mitigation, strict tag/attribute allowlist
 * - Link security: target="_blank", rel="noopener noreferrer nofollow", safe schemes only
 * - Image security: https:// only
 * - Input cap: 100KB max
 *
 * @param source Markdown source text
 * @returns Sanitized HTML
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) return ''

  // Cap input length
  const capped = source.slice(0, MAX_INPUT_LENGTH).trim()
  if (!capped) return ''

  // Render with marked (GFM enabled by default in v5+)
  let html: string
  try {
    html = marked.parse(capped) as string
  } catch {
    // If parsing fails, return empty to prevent rendering untrusted content
    return ''
  }

  // Sanitize
  const sanitized = sanitizeHtml(html, MARKDOWN_POLICY).trim()

  return sanitized
}

/**
 * Convert markdown source to plain text (no HTML tags).
 *
 * Useful for summaries, RSS descriptions, and LLM input. Whitespace is
 * collapsed to single spaces, and optionally truncated at a word boundary.
 *
 * @param source Markdown source text
 * @param maxLength Optional max length; if provided, truncates at word boundary with "…"
 * @returns Plain text
 */
export function markdownToPlainText(source: string, maxLength?: number): string {
  if (!source || !source.trim()) return ''

  // Render to HTML first (uses same input cap)
  const html = renderMarkdown(source)
  if (!html) return ''

  // Strip all HTML tags
  const text = html.replace(/<[^>]*>/g, '').trim()

  // Collapse whitespace
  const collapsed = text.replace(/\s+/g, ' ')

  // Optionally truncate at word boundary
  if (maxLength !== undefined && collapsed.length > maxLength) {
    let truncated = collapsed.slice(0, maxLength)
    // Find last space before limit
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > 0) {
      truncated = truncated.slice(0, lastSpace)
    }
    return truncated + '…'
  }

  return collapsed
}
