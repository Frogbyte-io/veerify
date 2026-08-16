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
  ],

  allowedAttributes: {
    // `target` and `rel` are added by transformTags below and must be listed
    // here too, or the allowlist filters them straight back out.
    a: ['href', 'title', 'target', 'rel'],
    // Kept so table structure survives; they cannot carry behaviour.
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
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
    a: (tagName, attribs) => {
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
        return { tagName, attribs: attribs.title ? { title: attribs.title } : {} }
      }

      // Any surviving link leaves the app. `noopener` stops `window.opener`
      // access; `noreferrer` stops the agent's URL — which contains a
      // conversation id — leaking to the linked site.
      return {
        tagName,
        attribs: { ...attribs, href, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }
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
  if (!clean || !clean.replace(/<[^>]*>/g, '').trim()) return null

  return clean
}
