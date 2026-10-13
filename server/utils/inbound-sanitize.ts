import sanitizeHtml from 'sanitize-html'

/**
 * Sanitization of inbound email HTML, applied on ingest before anything is
 * stored in `conversationMessage.bodyHtml`.
 *
 * Inbound HTML is hostile input rendered straight into the agent UI — a
 * `<script>` in a customer's email would otherwise execute in an authenticated
 * agent's session, with their cookies. `design.md` requires **both** layers:
 * sanitize on ingest *and* render in a sandboxed iframe. This is the first.
 * Neither is sufficient alone, and the iframe is not a licence to relax this.
 *
 * Deliberately built on `sanitize-html` rather than a hand-written allowlist.
 * The dangerous part is not parsing HTML, it is the long tail of bypasses —
 * `javascript:` URLs behind entity encoding, `<svg>`/`<math>` foreign-content
 * parsing quirks, mXSS via mutated re-serialization, CSS `expression()`. A
 * regex sanitizer written from scratch fails to those.
 */

/**
 * A deliberately small allowlist: enough for an email to remain readable, and
 * nothing that can execute, load, or exfiltrate.
 *
 * Not allowed, all on purpose:
 * - `script`, `iframe`, `object`, `embed`, `form`, `input`, `button` — execution and phishing
 * - `style` elements and `style` attributes — CSS is an exfiltration and overlay vector
 * - `link`, `meta`, `base` — external loads and base-URI hijacking
 * - `img` — a remote `src` is a tracking pixel that fires the moment an agent
 *   opens a ticket, and leaks their IP to the sender. Inline images arrive as
 *   attachments with `Content-ID` references (SUP-03-8); rendering those means
 *   rewriting `cid:` to a URL served from our own storage, which is a
 *   deliberate decision for that item rather than something to allow blindly
 *   here.
 */
const POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'div',
    'span',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'strike',
    'sub',
    'sup',
    'code',
    'pre',
    'blockquote',
    'a',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    // Only survives when `transformTags` below confirms the src is one of our
    // own stored attachments. A remote src is still dropped.
    'img',
  ],

  allowedAttributes: {
    // `target` and `rel` are added by transformTags below and must be listed
    // here too, or the allowlist filters them straight back out.
    a: ['href', 'title', 'target', 'rel'],
    // Kept so table structure survives; they cannot carry behaviour.
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    // `img` is allowed only for inline attachments already stored by SUP-03-8
    // and rewritten to our own attachment route. The `transformTags` entry
    // below is what enforces that; this list only says which attributes may
    // survive once it has.
    img: ['src', 'alt', 'title'],
  },

  // http/https/mailto only. This is what stops `javascript:`, `data:` (inline
  // script and content-spoofing payloads), and `vbscript:`.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],

  // Relative URLs in an email have no meaningful base and would resolve against
  // the app's own origin, so they are dropped rather than rewritten.
  allowProtocolRelative: false,

  // Drop the contents of removed elements too. Leaving the text of a <script>
  // behind produces confusing bodies full of source code.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],

  transformTags: {
    a: (tagName: string, attribs: Record<string, string>) => {
      const href = (attribs.href ?? '').trim()

      // `allowedSchemes` only governs URLs that *have* a scheme, so a relative
      // href like `/settings` passes it untouched — and in the agent UI that
      // resolves against our own origin, turning a hostile email into a link
      // into the authenticated app. An email has no meaningful base URL, so a
      // relative href is broken anyway: drop it and keep the text.
      const isAbsoluteSafe = /^(https?:|mailto:)/i.test(href)
      if (!isAbsoluteSafe) {
        // `title` is the only other attribute the allowlist permits here, so
        // keeping it is the whole of "drop the link, keep everything else".
        const kept: Record<string, string> = {}
        if (attribs.title) kept.title = attribs.title
        return { tagName, attribs: kept }
      }

      // Any surviving link leaves the app. `noopener` stops `window.opener`
      // access; `noreferrer` stops the agent's URL — which contains a
      // conversation id — leaking to the linked site.
      return {
        tagName,
        attribs: { ...attribs, href, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }
    },

    // Inline attachment images only (SUP-03-8). By the time HTML reaches the
    // sanitizer, `cid:` references to attachments that actually arrived have
    // already been rewritten to `/api/support/attachments/<id>`, which is
    // same-origin and access-checked.
    //
    // Anything else is dropped rather than rewritten: a remote `src` is a
    // tracking pixel that fires the moment an agent opens the ticket and leaks
    // their IP to the sender, and a surviving `cid:` refers to something that
    // never arrived. The prefix test is deliberately literal — a scheme-bearing
    // URL like `https://evil/api/support/attachments/x` fails it, because the
    // match is anchored at the start of the string.
    img: (tagName, attribs) => {
      const src = (attribs.src ?? '').trim()
      const isOwnAttachment = /^\/api\/support\/attachments\/[A-Za-z0-9-]+$/.test(src)

      if (!isOwnAttachment) {
        // `sanitize-html` drops a tag whose transform yields no tag name.
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
 * Returns sanitized HTML, or `null` when there is nothing renderable left.
 *
 * `null` rather than an empty string so the caller can distinguish "no HTML
 * part" from "HTML that sanitized down to nothing" — a message whose entire
 * body was a payload should fall back to the plain-text body, not render blank.
 */
export function sanitizeInboundHtml(html: string | null): string | null {
  if (!html || !html.trim()) return null

  const clean = sanitizeHtml(html, POLICY).trim()

  // Tags with no text (an empty table shell, say) are not renderable content.
  //
  // A surviving `<img>` is the exception, and only became one when SUP-03-8
  // started allowing inline attachment images: a mail whose whole body is a
  // screenshot has no text at all, and nulling it would render the message
  // blank. Any `img` still present here has already been proved to point at
  // our own attachment route by the transform above.
  const hasText = Boolean(clean.replace(/<[^>]*>/g, '').trim())
  const hasImage = /<img\b/i.test(clean)
  if (!clean || (!hasText && !hasImage)) return null

  return clean
}
