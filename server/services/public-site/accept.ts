/** Quality of `type` in an Accept header (0 when absent), honouring `*` wildcards only for `text/*`. */
function acceptQuality(accept: string, type: string) {
  let best = 0
  for (const part of accept.split(',')) {
    const [range, ...params] = part.trim().toLowerCase().split(';')
    if (range !== type && range !== `${type.split('/')[0]}/*`) continue
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    const quality = q ? Number(q.slice(2)) : 1
    if (Number.isFinite(quality)) best = Math.max(best, range === type ? quality : quality * 0.99)
  }
  return best
}

/** True when the client ranks markdown at least as high as HTML (agents such as Claude Code ask this way). */
export function acceptsMarkdownOverHtml(accept: string | undefined) {
  if (!accept) return false
  const markdown = acceptQuality(accept, 'text/markdown')
  return markdown > 0 && markdown >= acceptQuality(accept, 'text/html')
}
