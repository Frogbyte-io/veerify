/**
 * Reply-quote and signature stripping for inbound mail.
 *
 * A support thread should read as a conversation, not as a stack of nested
 * quotations. Every reply a customer sends carries the whole history below it,
 * and the agent already has that history in the thread.
 *
 * **Nothing is lost.** The untouched input comes back as `rawBody`, which the
 * caller stores on `conversationMessage.metadata` — so a bad strip is a
 * rendering annoyance, recoverable from the record, not data loss. That is why
 * the heuristics below can afford to be aggressive.
 */

/**
 * Markers that begin quoted history. Everything from the first match onward is
 * dropped. Ordered loosely by how common they are in the wild.
 */
const QUOTE_MARKERS: RegExp[] = [
  // Gmail / Apple Mail: "On Mon, 3 Aug 2026 at 14:02, Jane <j@x.com> wrote:"
  // The date portion varies hugely by locale, so anchor on "On … wrote:"
  // instead of trying to parse it. `[\s\S]` so it survives the line wrap
  // clients insert mid-attribution.
  /^\s*On\s[\s\S]{0,200}?\swrote:\s*$/im,
  // Outlook, English and the common localisations of the same divider.
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Ursprüngliche Nachricht\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Message d'origine\s*-{2,}\s*$/im,
  // Outlook's header block, which appears without a divider in newer versions.
  /^\s*From:\s.+$\n^\s*Sent:\s.+$/im,
  /^\s*From:\s.+$\n^\s*Date:\s.+$/im,
  // Forwarded blocks.
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  // Some clients write a bare attribution line.
  /^\s*\w+.{0,120}\swrote:\s*$/im,
]

/**
 * RFC 3676 signature delimiter: exactly "-- " on its own line. Matched with a
 * tolerance for the trailing space being stripped in transit, which happens
 * often enough to matter.
 */
const SIGNATURE_DELIMITER = /^--[ \t]?$/m

/** Minimal HTML → text, used only when a message has no text/plain part. */
function htmlToText(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // Block containers become a paragraph break, so consecutive <p> blocks do
      // not run together into one wall of text. The \n{3,} collapse below keeps
      // nested containers from opening up gaps.
      .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
      .replace(/<\/(tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  )
}

/** Drop a trailing run of `>`-quoted lines, which clients add without a marker. */
function dropTrailingQuotedLines(text: string): string {
  const lines = text.split('\n')
  let end = lines.length

  while (end > 0) {
    const line = lines[end - 1].trim()
    if (line === '' || line.startsWith('>')) {
      end--
      continue
    }
    break
  }

  return lines.slice(0, end).join('\n')
}

export interface StrippedBody {
  /** Quoted history and signature removed; safe to render as the message. */
  body: string
  /** Exactly what arrived, for `conversationMessage.metadata`. */
  rawBody: string
}

export function stripQuotedReply(input: { text: string | null; html: string | null }): StrippedBody {
  const rawBody = input.text ?? input.html ?? ''

  // Prefer text/plain. Falling back to a flattened HTML body keeps HTML-only
  // senders (Outlook web, many mobile clients) from producing an empty message.
  const source = input.text && input.text.trim() ? input.text : input.html ? htmlToText(input.html) : ''

  if (!source.trim()) return { body: '', rawBody }

  // Cut at the earliest quote marker rather than the first one that happens to
  // match — a message can contain several, and only the earliest is the real
  // boundary.
  let cut = source.length
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(source)
    if (match && match.index < cut) cut = match.index
  }

  let body = source.slice(0, cut)
  body = dropTrailingQuotedLines(body)

  const signature = SIGNATURE_DELIMITER.exec(body)
  if (signature) body = body.slice(0, signature.index)

  // Collapse the run of blank lines the cut usually leaves behind, and trim.
  body = body.replace(/\n{3,}/g, '\n\n').trim()

  // A strip that removes everything means the heuristics misfired — a message
  // that is genuinely nothing but a quote is far rarer than a false match.
  // Fall back to the flattened source rather than storing an empty message.
  if (!body) body = source.replace(/\n{3,}/g, '\n\n').trim()

  return { body, rawBody }
}
