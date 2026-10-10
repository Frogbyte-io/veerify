/** Validation of llms.txt per https://llmstxt.org. Pure. */

export interface LlmsTxtLink {
  name: string
  url: string
  notes: string | null
}

export interface LlmsTxtSection {
  title: string
  links: LlmsTxtLink[]
}

export interface LlmsTxtResult {
  valid: boolean
  title: string | null
  summary: string | null
  sections: LlmsTxtSection[]
  problems: string[]
}

const LINK_ITEM = /^[-*+]\s+\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)\s*(?::\s*(.*))?$/

export function validateLlmsTxt(body: string): LlmsTxtResult {
  const problems: string[] = []
  const sections: LlmsTxtSection[] = []
  let title: string | null = null
  let summary: string | null = null

  const text = body.replace(/^\uFEFF/, '')
  if (text.trim() === '') {
    return { valid: false, title, summary, sections, problems: ['The file is empty'] }
  }
  if (/^\s*<(!doctype|html|head|body)/i.test(text)) {
    return {
      valid: false,
      title,
      summary,
      sections,
      problems: ['The file looks like an HTML page, not Markdown'],
    }
  }

  const lines = text.split(/\r\n|\n|\r/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++

  const h1 = /^#\s+(\S.*)$/.exec(lines[i] ?? '')
  if (h1) {
    title = h1[1].trim()
    i++
  } else {
    problems.push('The first line must be an H1 with the site or project name ("# Name")')
  }

  // Optional blockquote summary directly after the H1 (blank lines allowed).
  let j = i
  while (j < lines.length && lines[j].trim() === '') j++
  if (j < lines.length && lines[j].startsWith('>')) {
    const quote: string[] = []
    while (j < lines.length && lines[j].startsWith('>')) {
      quote.push(lines[j].replace(/^>\s?/, '').trim())
      j++
    }
    summary = quote.join(' ').trim() || null
    i = j
  }

  let current: LlmsTxtSection | null = null
  let extraH1 = false
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '') continue
    if (/^#\s/.test(trimmed)) {
      extraH1 = true
      continue
    }
    const h2 = /^##\s+(\S.*)$/.exec(trimmed)
    if (h2) {
      current = { title: h2[1].trim(), links: [] }
      sections.push(current)
      continue
    }
    if (/^[-*+]\s/.test(trimmed)) {
      const m = LINK_ITEM.exec(trimmed)
      if (!m) {
        problems.push(`List item is not a link in the form "- [name](url): notes": "${trimmed.slice(0, 80)}"`)
        continue
      }
      if (!current) {
        problems.push(`Link "${m[1]}" appears before any H2 section`)
        continue
      }
      const url = m[2]
      if (url === '' || /^(javascript|data):/i.test(url)) {
        problems.push(`Link "${m[1]}" has an invalid URL`)
        continue
      }
      current.links.push({ name: m[1].trim(), url, notes: m[3]?.trim() || null })
    }
    // Other lines are free-form details, which the spec allows.
  }

  if (extraH1) problems.push('Only one H1 is allowed; use H2 for sections')
  if (title !== null && sections.length === 0) {
    problems.push('No H2 sections found; add sections containing link lists')
  } else if (title !== null && sections.every((s) => s.links.length === 0)) {
    problems.push('No links found in any section')
  }

  return { valid: problems.length === 0, title, summary, sections, problems }
}
