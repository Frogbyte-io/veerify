import { createHash } from 'node:crypto'
import { Parser } from 'htmlparser2'

/** Normalised page text stored per watch. */
export const MAX_TEXT_BYTES = 50 * 1024
/** Each side of a stored diff excerpt. */
export const MAX_EXCERPT_CHARS = 4 * 1024
/** Changes smaller than this are treated as noise. */
export const NOISE_MIN_LINES = 2
export const NOISE_MIN_CHARS = 40
/** Above this many cells the exact LCS is skipped for a cheaper set diff. */
const MAX_LCS_CELLS = 4_000_000

/** Elements whose content is never part of the page body we compare. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'nav', 'footer', 'iframe', 'canvas'])
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'li',
  'ul',
  'ol',
  'tr',
  'td',
  'th',
  'table',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'dt',
  'dd',
  'form',
  'button',
  'label',
  'figure',
  'figcaption',
  'details',
  'summary',
])

/** Tokens that change on every request without the page content changing. */
export function stripVolatile(line: string): string {
  return (
    line
      // ISO 8601 timestamps
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '')
      // clock times like 14:03:22
      .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, '')
      // hex strings (CSRF tokens, build hashes, nonces)
      .replace(/\b[0-9a-f]{24,}\b/gi, '')
      // long opaque tokens mixing letters and digits
      .replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '')
      // epoch seconds / milliseconds used as cache busters
      .replace(/\b1\d{9}(\d{3})?\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** HTML to visible text, one block per line, volatile tokens removed, capped at 50 KB. */
export function normalizeHtml(html: string): string {
  const lines: string[] = []
  let current = ''
  let skipDepth = 0
  const flush = () => {
    const line = stripVolatile(current)
    if (line) lines.push(line)
    current = ''
  }

  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED.has(name)) {
          skipDepth++
          return
        }
        if (skipDepth === 0 && BLOCKS.has(name)) flush()
      },
      ontext(text) {
        if (skipDepth === 0) current += text
      },
      onclosetag(name) {
        if (SKIPPED.has(name)) {
          if (skipDepth > 0) skipDepth--
          return
        }
        if (skipDepth === 0 && BLOCKS.has(name)) flush()
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true }
  )
  parser.write(html.length > 2_500_000 ? html.slice(0, 2_500_000) : html)
  parser.end()
  flush()

  return capText(lines.join('\n'), MAX_TEXT_BYTES)
}

/** Cuts to at most `maxBytes` UTF-8 bytes, on a line boundary where possible. */
export function capText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  // a split multi-byte character decodes to U+FFFD at the end
  const cut = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/�+$/, '')
  const newline = cut.lastIndexOf('\n')
  return newline > 0 ? cut.slice(0, newline) : cut
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface LineDiff {
  added: string[]
  removed: string[]
}

function capLines(lines: string[], maxChars: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + 1
    if (used + cost > maxChars) {
      const room = maxChars - used - 1
      if (room > 20) out.push(`${line.slice(0, room - 1)}…`)
      break
    }
    out.push(line)
    used += cost
  }
  return out
}

/** Line diff by longest common subsequence. Each side is capped to 4 KB of text for storage. */
export function diffLines(before: string, after: string): LineDiff {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  const removed: string[] = []
  const added: string[] = []
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    const setA = new Set(midA)
    const setB = new Set(midB)
    removed.push(...midA.filter((line) => !setB.has(line)))
    added.push(...midB.filter((line) => !setA.has(line)))
  } else {
    const n = midA.length
    const m = midB.length
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        i++
        j++
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        removed.push(midA[i++])
      } else {
        added.push(midB[j++])
      }
    }
    while (i < n) removed.push(midA[i++])
    while (j < m) added.push(midB[j++])
  }

  return { added: capLines(added, MAX_EXCERPT_CHARS), removed: capLines(removed, MAX_EXCERPT_CHARS) }
}

/** True when the change is too small to report: fewer than 2 changed lines and under 40 chars. */
export function isNoise(diff: LineDiff): boolean {
  const lines = diff.added.length + diff.removed.length
  const chars = [...diff.added, ...diff.removed].reduce((sum, line) => sum + line.length, 0)
  return lines < NOISE_MIN_LINES && chars < NOISE_MIN_CHARS
}
