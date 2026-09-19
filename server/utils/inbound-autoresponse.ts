/**
 * Auto-response detection for inbound mail.
 *
 * Two failure modes this prevents, both from `stage-03-inbound-email.md`:
 * an out-of-office reply reopening a resolved ticket, and — once Stage 04 can
 * send — an auto-reply meeting an auto-reply and generating unbounded traffic.
 *
 * Ships in Stage 03 even though auto-reply *sending* is Stage 04, because the
 * detection has to exist before anything can be sent.
 *
 * **Bias: false negatives over false positives.** A missed auto-reply creates
 * one junk message an agent can see and delete. A false positive silently
 * discards a real customer email, which nobody ever finds out about. So this
 * only matches signals that are unambiguous in practice.
 */

/** Headers arrive with provider-dependent casing; compare lowercased. */
function normalize(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key.toLowerCase().trim()] = value.trim()
  }
  return out
}

export function isAutoResponse(headers: Record<string, string>): boolean {
  const h = normalize(headers)

  // RFC 3834. Any value other than "no" means generated without a human
  // deciding to send this particular message: auto-replied, auto-generated,
  // auto-notified.
  const autoSubmitted = h['auto-submitted']?.toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true

  // Non-standard but near-universal among the clients that send vacation
  // replies. Presence alone is the signal; the value is not meaningful.
  if ('x-autoreply' in h || 'x-autorespond' in h) return true
  if (h['x-autoreply-from']) return true

  // Microsoft/Exchange sets this on generated mail.
  if (h['x-auto-response-suppress']) return true

  // A null return-path (`<>`) is the RFC 5321 marker for a bounce or other
  // notification that must never itself be replied to.
  const returnPath = h['return-path']
  if (returnPath === '<>' || returnPath === '') return true

  // Only `auto_reply` here. `bulk` and `list` are deliberately NOT treated as
  // auto-responses: legitimate mail a customer forwards from a newsletter or
  // a notification service carries them routinely, and dropping that loses
  // real support requests.
  if (h['precedence']?.toLowerCase() === 'auto_reply') return true

  return false
}
