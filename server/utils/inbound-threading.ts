import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { conversation, conversationMessage } from '~/server/database/schema/support'

/**
 * Threading resolution for inbound mail — deciding whether a message continues
 * an existing conversation or starts a new one.
 *
 * `stage-03-inbound-email.md` calls this "the classic source of duplicate
 * tickets", and the failure is asymmetric: a missed match splits one
 * conversation into two, which an agent can merge, while a wrong match shows
 * one customer another customer's correspondence. So header matching (strong,
 * exact) is tried before the subject heuristic (weak, bounded), and the
 * heuristic never crosses contacts.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * The subset of `InboundMessage` threading actually reads.
 *
 * **Deliberately structural rather than importing `InboundMessage`** from
 * `server/services/support-channels/types.ts` (Agent 1's file). An
 * `InboundMessage` satisfies this shape, so the call site in
 * `parallel-agents.md` compiles unchanged — but `server/utils/` does not take a
 * dependency on `server/services/support-channels/`, and these tests need only
 * four fields rather than a whole normalized message. Flagged to Agent 1 rather
 * than changed silently.
 */
export interface ThreadableMessage {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string | null
}

export type ThreadMatch = 'message-id' | 'thread-key' | 'subject' | 'ambiguous-message-id' | null

export interface ThreadResolution {
  /** `null` means "no match — create a new conversation". Never creates one. */
  conversationId: string | null
  matchedBy: ThreadMatch
}

/** How far back the subject heuristic will look. Bounded on purpose. */
export const SUBJECT_FALLBACK_WINDOW_DAYS = 7

/** Statuses a subject match may attach to. A closed ticket starts a new one. */
const REOPENABLE_STATUSES = ['open', 'pending']

/**
 * Strip reply and forward prefixes, repeatedly, then normalize for comparison.
 *
 * Prefixes stack (`Re: Fwd: Re: …`) and localise, and a numbered variant
 * (`Re[2]:`) is common in several clients. Exported for its own unit tests —
 * subject mangling is where this heuristic most easily goes wrong.
 */
export function normalizeSubject(subject: string | null): string {
  if (!subject) return ''

  let out = subject.trim()
  // English, German, French, Spanish/Portuguese, Dutch, Nordic, Italian.
  const prefix = /^\s*(re|fw|fwd|aw|wg|antwort|rép|ref|res|rv|sv|vs|vb|doorst|i)\s*(\[\d+\])?\s*:\s*/i

  // Loop: one pass only removes the outermost prefix.
  while (prefix.test(out)) out = out.replace(prefix, '')

  return out.replace(/\s+/g, ' ').trim().toLowerCase()
}

export async function resolveThread(
  tx: Tx,
  inbox: { id: string; teamId: string },
  message: ThreadableMessage,
  contactId: string
): Promise<ThreadResolution> {
  // 1. Exact header match. `In-Reply-To` plus every `References` entry, since
  //    clients disagree about which they populate.
  //
  //    Deliberately NOT scoped to `contactId`: a CC'd participant replying is a
  //    different contact on the same thread, and dropping to the subject
  //    heuristic there would be strictly worse. It IS scoped to the inbox, so a
  //    Message-ID cannot pull a message into another team's conversation.
  const referenced = [message.inReplyTo, ...message.references].filter((id): id is string => Boolean(id))

  if (referenced.length > 0) {
    const messageIdMatches = await tx
      .select({ conversationId: conversationMessage.conversationId })
      .from(conversationMessage)
      .innerJoin(conversation, eq(conversationMessage.conversationId, conversation.id))
      .where(and(inArray(conversationMessage.channelMessageId, referenced), eq(conversation.inboxId, inbox.id)))
      .orderBy(desc(conversationMessage.createdAt))
      .limit(2)

    // Never guess when an RFC ID identifies more than one stored message in
    // the receiving inbox. This remains ambiguous even when both rows happen
    // to belong to the same conversation: the identity itself is no longer
    // trustworthy, so weaker thread-key and subject fallbacks must not run.
    if (messageIdMatches.length > 1) return { conversationId: null, matchedBy: 'ambiguous-message-id' }
    if (messageIdMatches[0]) {
      return { conversationId: messageIdMatches[0].conversationId, matchedBy: 'message-id' }
    }

    // 2. The root of the References chain against a stored thread key. Catches
    //    a reply whose immediate parent we never stored — a customer replying
    //    to their own earlier mail, for instance.
    const root = message.references[0] ?? message.inReplyTo
    if (root) {
      const [byThreadKey] = await tx
        .select({ id: conversation.id })
        .from(conversation)
        .where(and(eq(conversation.channelThreadKey, root), eq(conversation.inboxId, inbox.id)))
        .limit(1)

      if (byThreadKey) return { conversationId: byThreadKey.id, matchedBy: 'thread-key' }
    }
  }

  // 3. Subject heuristic. The risky one, so it is fenced in four ways: same
  //    inbox, **same contact**, still open or pending, and inside a bounded
  //    window. Without the contact scope, two customers mailing "Invoice
  //    question" would land in one conversation and each would see the other's
  //    correspondence.
  const normalized = normalizeSubject(message.subject)
  if (!normalized) return { conversationId: null, matchedBy: null }

  const cutoff = new Date(Date.now() - SUBJECT_FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const candidates = await tx
    .select({ id: conversation.id, subject: conversation.subject })
    .from(conversation)
    .where(
      and(
        eq(conversation.inboxId, inbox.id),
        eq(conversation.contactId, contactId),
        inArray(conversation.status, REOPENABLE_STATUSES),
        gte(conversation.lastActivityAt, cutoff)
      )
    )
    .orderBy(desc(conversation.lastActivityAt))
    .limit(25)

  // Compare normalized, in JS: the stored subject carries its own prefixes and
  // whitespace, so a SQL equality test would miss "Re: Invoice" vs "Invoice".
  const match = candidates.find((row) => normalizeSubject(row.subject) === normalized)
  if (match) return { conversationId: match.id, matchedBy: 'subject' }

  return { conversationId: null, matchedBy: null }
}
