import {
  appendSignature,
  buildOutboundIdentity,
  buildQuotedHistory,
  buildReferences,
  generateMessageId,
} from '~/lib/support-email'
import type { OutboundAttachment, OutboundDeliveryPayload } from '~/server/utils/outbound-delivery'

/**
 * Compose everything SUP-04-4 needs for one outgoing reply: the threading
 * headers, the quoted-history + signature body, and the resulting
 * `OutboundDeliveryPayload` to enqueue.
 *
 * Pure - every input is already-resolved data (contact row, inbox row, the
 * previous message, cc list), so this has no db/io and is fully unit-testable.
 * The endpoint's job is only to fetch that data and call this.
 */

export interface OutgoingReplyInput {
  inbox: { emailAddress: string; fromName: string | null; signature: string | null }
  contact: { email: string; name: string | null }
  cc: { email: string }[]
  subject: string
  agentBody: string
  agentBodyHtml: string | null
  /** The message being replied to, or null when this is the thread's first agent reply. */
  previous: {
    channelMessageId: string
    /** This previous message's own References chain, oldest → newest, stripped. */
    references: string[]
    fromName: string
    sentAt: Date
    body: string
    bodyHtml: string | null
  } | null
  /** Seed for `generateMessageId` - the new `conversationMessage.id`. */
  newMessageId: string
  /** Domain for the generated Message-ID - inbox domain, falling back to MAIL_FROM's (parallel-agents.md, answered question 2). */
  domain: string
  attachments: OutboundAttachment[]
}

export interface OutgoingReplyResult {
  /** Stripped, for `conversationMessage.channelMessageId`. */
  channelMessageId: string
  /** Stripped, for `conversationMessage.inReplyTo`. */
  inReplyTo: string | null
  /** Bracketed, space-joined, for `conversationMessage.channelHeaders.references` - matches how Stage 03 stores a raw References header. Null when the chain is empty. */
  referencesForStorage: string | null
  deliveryPayload: OutboundDeliveryPayload
}

function prefixedSubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`
}

export function buildOutgoingReply(input: OutgoingReplyInput): OutgoingReplyResult {
  const channelMessageId = generateMessageId({ messageId: input.newMessageId, domain: input.domain })

  const inReplyTo = input.previous?.channelMessageId ?? null
  const references = buildReferences({
    existing: input.previous?.references ?? [],
    inReplyTo,
  })

  const { html: quotedHtml, text: quotedText } = buildQuotedHistory({
    previous: input.previous
      ? [
          {
            fromName: input.previous.fromName,
            sentAt: input.previous.sentAt,
            body: input.previous.body,
            bodyHtml: input.previous.bodyHtml,
          },
        ]
      : [],
  })

  const signed = appendSignature({
    html: `<p>${input.agentBodyHtml ?? input.agentBody}</p>`,
    text: input.agentBody,
    signature: input.inbox.signature,
  })

  const html = quotedHtml ? `${signed.html}<br><br>${quotedHtml}` : signed.html
  const text = quotedText ? `${signed.text}\n\n${quotedText}` : signed.text

  const identity = buildOutboundIdentity({ emailAddress: input.inbox.emailAddress, fromName: input.inbox.fromName })

  const headers: Record<string, string> = { 'Message-ID': `<${channelMessageId}>` }
  if (inReplyTo) headers['In-Reply-To'] = `<${inReplyTo}>`
  if (references.length > 0) headers.References = references.map((id) => `<${id}>`).join(' ')

  return {
    channelMessageId,
    inReplyTo,
    referencesForStorage: references.length > 0 ? references.map((id) => `<${id}>`).join(' ') : null,
    deliveryPayload: {
      to: input.contact.email,
      cc: input.cc.length > 0 ? input.cc.map((c) => c.email) : undefined,
      subject: prefixedSubject(input.subject),
      html,
      text,
      from: identity.from,
      replyTo: identity.replyTo,
      headers,
      attachments: input.attachments.length > 0 ? input.attachments : undefined,
    },
  }
}
