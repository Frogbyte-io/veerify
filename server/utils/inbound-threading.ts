import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { conversation, conversationMessage } from '~/server/database/schema/support'

/**
 * Threading resolution for inbound mail — deciding whether a message continues
 * an existing conversation or starts a new one.
 *
 * A missed match splits a conversation, while a wrong match risks exposing
 * another customer's correspondence. Exact header matching therefore precedes
 * the weaker subject heuristic, which never crosses contacts.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * The subset of `InboundMessage` threading actually reads.
 *
 * Kept structural so threading does not depend on the channel adapter's
 * normalized message type. The inbound adapter satisfies these four fields.
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

interface InboundConversationState {
  status: string
}

/**
 * State written when mail continues an existing thread. A resolved ticket is
 * reopened, while omission of `assigneeUserId` deliberately preserves its
 * owner. The weak subject fallback never selects a resolved thread, so this
 * path is reached only by a strong RFC header/thread-key match.
 */
export function updatesForInboundReply(existing: InboundConversationState, receivedAt: Date, updatedAt: Date) {
  return {
    ...(existing.status === 'resolved' || existing.status === 'pending'
      ? { status: 'open', ...(existing.status === 'resolved' ? { resolvedAt: null } : {}) }
      : {}),
    lastActivityAt: receivedAt,
    lastCustomerReplyAt: receivedAt,
    updatedAt,
  }
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

/** A stored message found by `resolveThread`'s exact header lookup. */
export interface MessageIdMatch {
  conversationId: string
  channelMessageId: string | null
  providerChannelMessageId: string | null
}

/**
 * Decide a thread from the stored messages the referenced RFC ids matched.
 *
 * Rows are attributed to the referenced id they were matched by, with the same
 * exact string comparison the SQL `IN` used, so one stored message may be
 * matched through either its own id or the provider-rewritten one.
 *
 * - A single referenced id naming more than one stored message is ambiguous,
 *   even when those rows share a conversation: the identity itself is no
 *   longer trustworthy, so weaker fallbacks must not run either.
 * - Distinct ids each naming one message is normal. A reply's `References`
 *   lists the customer's original and our reply (Frogmail even appends our
 *   original id next to the SES-rewritten one). When they all sit in one
 *   conversation, that conversation wins.
 * - When they span conversations, the direct parent (`In-Reply-To`) decides,
 *   then the newest matching `References` entry (the header is ordered
 *   oldest to newest). Anything still undecided stays ambiguous.
 *
 * Returns `null` when nothing matched, so the caller moves on to the thread
 * key. Exported for unit tests.
 */
export function resolveMessageIdMatches(
  message: Pick<ThreadableMessage, 'inReplyTo' | 'references'>,
  matches: MessageIdMatch[]
): ThreadResolution | null {
  if (matches.length === 0) return null

  const ambiguous: ThreadResolution = { conversationId: null, matchedBy: 'ambiguous-message-id' }
  const referenced = new Set([message.inReplyTo, ...message.references].filter((id): id is string => Boolean(id)))

  const conversationByMessageId = new Map<string, string>()
  for (const messageId of referenced) {
    const rows = matches.filter(
      (row) => row.channelMessageId === messageId || row.providerChannelMessageId === messageId
    )
    if (rows.length > 1) return ambiguous
    if (rows[0]) conversationByMessageId.set(messageId, rows[0].conversationId)
  }

  const conversationIds = new Set(matches.map((row) => row.conversationId))
  if (conversationIds.size === 1) return { conversationId: [...conversationIds][0] ?? null, matchedBy: 'message-id' }

  const parentConversationId = message.inReplyTo ? conversationByMessageId.get(message.inReplyTo) : undefined
  if (parentConversationId) return { conversationId: parentConversationId, matchedBy: 'message-id' }

  for (const messageId of [...message.references].reverse()) {
    const conversationId = conversationByMessageId.get(messageId)
    if (conversationId) return { conversationId, matchedBy: 'message-id' }
  }

  return ambiguous
}

export async function resolveThread(
  tx: Tx,
  inbox: { id: string; projectId: string },
  message: ThreadableMessage,
  contactId: string
): Promise<ThreadResolution> {
  // 1. Exact header match. `In-Reply-To` plus every `References` entry, since
  //    clients disagree about which they populate.
  //
  //    Deliberately NOT scoped to `contactId`: a CC'd participant replying is a
  //    different contact on the same thread, and dropping to the subject
  //    heuristic there would be strictly worse. It IS scoped to the inbox, so a
  //    Message-ID cannot pull a message into another project's conversation.
  //
  //    Both the Message-ID Veerify generated and the one the provider reports
  //    having sent under are matched: SES (behind Frogmail) rewrites it, and a
  //    reply carrying only `In-Reply-To` then references the rewritten id.
  const referenced = [...new Set([message.inReplyTo, ...message.references].filter((id): id is string => Boolean(id)))]

  if (referenced.length > 0) {
    // One row more than the number of distinct ids referenced: without a
    // duplicated identity every stored row is claimed by at least one id and
    // no id claims two, so at most `referenced.length` rows exist. Reaching the
    // limit therefore already proves a duplicate, and anything under it is the
    // complete set needed to attribute rows to ids.
    const messageIdMatches = await tx
      .select({
        conversationId: conversationMessage.conversationId,
        channelMessageId: conversationMessage.channelMessageId,
        providerChannelMessageId: conversationMessage.providerChannelMessageId,
      })
      .from(conversationMessage)
      .innerJoin(conversation, eq(conversationMessage.conversationId, conversation.id))
      .where(
        and(
          or(
            inArray(conversationMessage.channelMessageId, referenced),
            inArray(conversationMessage.providerChannelMessageId, referenced)
          ),
          eq(conversation.inboxId, inbox.id)
        )
      )
      .orderBy(desc(conversationMessage.createdAt))
      .limit(referenced.length + 1)

    if (messageIdMatches.length > referenced.length) {
      return { conversationId: null, matchedBy: 'ambiguous-message-id' }
    }

    const byMessageId = resolveMessageIdMatches(message, messageIdMatches)
    if (byMessageId) return byMessageId

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

  // 3. Subject heuristic. The risky one, so it is fenced in five ways: same
  //    inbox, **same contact**, still open or pending, not in Spam or Trash
  //    (a guess must not file new mail into Spam, or restore a deleted
  //    conversation), and inside a bounded window. Without the contact scope, two customers mailing "Invoice
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
        isNull(conversation.spamAt),
        isNull(conversation.deletedAt),
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
