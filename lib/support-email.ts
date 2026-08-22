/**
 * Composition helpers for outbound support email: threading headers, quoted
 * history, and signature appending. Pure - no db, no io, so it is safe to
 * unit-test without a running server.
 *
 * `generateMessageId` returns the bare `local@domain` form, angle brackets
 * stripped, matching how Stage 03 stores `InboundMessage.messageId`
 * (`server/services/support-channels/types.ts`). The caller wraps it in
 * `<...>` only when writing the actual header. A bracketed value landing on
 * `channelMessageId` would make every customer reply open a new ticket -
 * see `tests/support-email.test.ts` for the assertion pinning this.
 */

export function generateMessageId(input: { messageId: string; domain: string }): string {
  return `${input.messageId}@${input.domain}`
}

/** Default cap on `References` entries before trimming kicks in. */
export const DEFAULT_MAX_REFERENCES = 50

export function buildReferences(input: {
  existing: string[]
  inReplyTo: string | null
  maxEntries?: number
}): string[] {
  const chain = [...input.existing]
  if (input.inReplyTo !== null && chain[chain.length - 1] !== input.inReplyTo) {
    chain.push(input.inReplyTo)
  }

  const maxEntries = input.maxEntries ?? DEFAULT_MAX_REFERENCES
  if (chain.length <= maxEntries || chain.length === 0) {
    return chain
  }

  // Keep the root (mail clients tolerate trimming but not a broken root)
  // plus the most recent entries, so the tail stays contiguous with any new
  // inReplyTo just appended above.
  const tailCount = maxEntries - 1
  return [chain[0], ...chain.slice(chain.length - tailCount)]
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export function buildQuotedHistory(input: {
  previous: { fromName: string; sentAt: Date; body: string; bodyHtml: string | null }[]
}): { html: string; text: string } {
  if (input.previous.length === 0) {
    return { html: '', text: '' }
  }

  const textParts = input.previous.map((message) => {
    const header = `On ${message.sentAt.toUTCString()}, ${message.fromName} wrote:`
    const quoted = message.body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    return `${header}\n${quoted}`
  })

  const htmlParts = input.previous.map((message) => {
    const header = `On ${message.sentAt.toUTCString()}, ${escapeHtml(message.fromName)} wrote:`
    const body = message.bodyHtml ?? escapeHtml(message.body).replace(/\n/g, '<br>')
    return `<p>${header}</p><blockquote>${body}</blockquote>`
  })

  return { text: textParts.join('\n\n'), html: htmlParts.join('') }
}

/**
 * The From and Reply-To identity for an outgoing reply, built from
 * `supportInbox`. There is no separate Reply-To column in the schema
 * (`design.md`'s `supportInbox` field list has none) and no per-conversation
 * reply-address token to thread on — Stage 03 threads on `Message-ID` /
 * `References` instead — so Reply-To is deliberately the same address as
 * From rather than a distinct setting.
 *
 * Callers must guard for `supportInbox.emailAddress` being null (it has no
 * `.notNull()` in the schema) before calling this; it is not this function's
 * job to decide what happens when an inbox has no sending address.
 */
export function buildOutboundIdentity(input: { emailAddress: string; fromName: string | null }): {
  from: { address: string; name?: string }
  replyTo: string
} {
  return {
    from: input.fromName ? { address: input.emailAddress, name: input.fromName } : { address: input.emailAddress },
    replyTo: input.emailAddress,
  }
}

export function appendSignature(input: { html: string; text: string; signature: string | null }): {
  html: string
  text: string
} {
  if (!input.signature) {
    return { html: input.html, text: input.text }
  }

  // "-- \n" is the RFC-recognized signature delimiter mail clients look for
  // to visually separate and, on reply, drop the signature block.
  const text = `${input.text}\n\n-- \n${input.signature}`
  const html = `${input.html}<br><br>${escapeHtml(input.signature).replace(/\n/g, '<br>')}`
  return { html, text }
}
