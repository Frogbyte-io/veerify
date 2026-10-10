/**
 * Draft `llms.txt` generator (llmstxt.org format). Template based, no LLM:
 * H1 name, blockquote summary, then H2 sections of `- [title](url): note` links.
 */

export interface LlmsTxtInput {
  name: string
  description: string | null
  origin: string
  /** Public feedback board URL; only when the board is enabled and the product is public */
  boardUrl?: string | null
  /** Public roadmap URL; only when the roadmap is enabled and the product is public */
  roadmapUrl?: string | null
  /** Crawled pages from the latest finished audit */
  pages?: { url: string; title: string | null }[]
}

export const LLMS_TXT_MAX_PAGES = 20

/** Keeps a title on one line and safe inside markdown link text. */
function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim()
}

function summaryLine(description: string | null, name: string): string {
  const text = cleanText(description ?? '')
  if (!text) return `${cleanText(name)}: add a one-sentence summary of your product here.`
  return text.length > 280 ? `${text.slice(0, 277)}...` : text
}

export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [`# ${cleanText(input.name)}`, '', `> ${summaryLine(input.description, input.name)}`, '']

  const origin = input.origin.replace(/\/+$/, '')
  lines.push('## Product', '', `- [Home](${origin}/): Main website`)
  if (input.boardUrl) lines.push(`- [Feedback board](${input.boardUrl}): Public feature requests and votes`)
  if (input.roadmapUrl) lines.push(`- [Roadmap](${input.roadmapUrl}): Planned and in-progress work`)
  lines.push('')

  const seen = new Set<string>([`${origin}/`, origin])
  const pages = (input.pages ?? [])
    .filter((page) => {
      const key = page.url.replace(/\/+$/, '')
      if (seen.has(page.url) || seen.has(key)) return false
      seen.add(page.url)
      seen.add(key)
      return true
    })
    .slice(0, LLMS_TXT_MAX_PAGES)

  if (pages.length > 0) {
    lines.push('## Docs', '')
    for (const page of pages) {
      let fallback = page.url
      try {
        fallback = new URL(page.url).pathname || page.url
      } catch {
        // keep the raw URL
      }
      const title = cleanText(page.title || '') || fallback
      lines.push(`- [${title}](${page.url})`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
