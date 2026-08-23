/**
 * Inbound channel adapter contract.
 *
 * Every provider driver normalizes its payload into `InboundMessage`.
 * **Nothing downstream may know which provider a message came from** — that is
 * the whole point of this boundary, and it is what lets IMAP re-enter later as
 * just another driver (delta D-29 dropped it as a polling channel, not as a
 * shape).
 *
 * `InboundMessage` is pinned by the Stage 03 agent contract in
 * `docs/plans/2026-08-11-support-platform/parallel-agents.md`: the threading,
 * quote-stripping, sanitization, and auto-response modules all consume it.
 * Changing a field here is a cross-agent change, not a local one.
 */

export interface InboundAddress {
  address: string
  name?: string
}

export interface InboundAttachment {
  /** Provider-supplied filename, already basename-only — never a path. */
  fileName: string
  contentType: string | null
  /** Decoded bytes. Callers enforce the per-message size cap (SUP-03-8). */
  content: Buffer
  size: number
  /**
   * RFC 2392 Content-ID with angle brackets stripped, when the part carries
   * one. Inline images reference this from `src="cid:..."`, which is how the
   * thread pane rewrites them to storage URLs.
   */
  contentId: string | null
  isInline: boolean
}

export interface InboundMessage {
  /** RFC Message-ID, angle brackets stripped. */
  messageId: string | null
  inReplyTo: string | null
  /** Oldest → newest, angle brackets stripped. */
  references: string[]
  from: InboundAddress
  to: InboundAddress[]
  cc: InboundAddress[]
  subject: string | null
  text: string | null
  html: string | null
  attachments: InboundAttachment[]
  receivedAt: Date
  /** Header names lowercased, so lookups do not depend on provider casing. */
  rawHeaders: Record<string, string>
}

/**
 * Why a payload was rejected. The endpoint maps `signature` to 401 and
 * everything else to a recorded event plus 200 — a provider that gets a 4xx
 * for a malformed body will retry it forever.
 */
export type InboundRejectionReason = 'signature' | 'malformed'

export interface InboundVerificationInput {
  /** Exact bytes as received. Signature schemes cover the raw body, not a re-serialized object. */
  rawBody: string
  /** Header names lowercased by the caller. */
  headers: Record<string, string>
  /** Present only when the provider authenticates via HTTP Basic rather than a signature. */
  authorization?: string
}

/**
 * Which env vars a provider still needs. Names only, never values - the
 * channel card built in SUP-03-13 is visible to any team member.
 *
 * Lives on the driver because delta D-34 flagged the alternative: a
 * `REQUIRED_ENV` map hard-coded in `channel-status.get.ts`, which meant adding
 * a provider silently meant editing two places.
 */
export interface ChannelConfiguration {
  configured: boolean
  missing: string[]
}

/**
 * Whether the provider will accept mail sent as a given address.
 *
 * `unknown` is a first-class answer and not a failure mode. "Not authorized"
 * and "could not check" are different things, and a settings warning that
 * confuses them would cry wolf on every deployment that has not set an API
 * credential - which today is all of them.
 */
export type SendingAuthorization =
  | { status: 'authorized' }
  | { status: 'unauthorized'; verifiedDomains: string[] }
  | { status: 'unknown'; reason: string }

/** Injected so the provider lookups are testable without a network. */
export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

/** Lowercased domain of an email address, or null when there isn't one. */
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain.length > 0 ? domain : null
}

/**
 * Shared verdict logic: does `address` sit on one of `verifiedDomains`?
 *
 * Both providers differ only in how they report their domain list, so the
 * comparison itself is kept in one place - a case-sensitivity slip here would
 * warn about a perfectly good From address.
 */
export function authorizationForDomains(address: string, verifiedDomains: string[]): SendingAuthorization {
  const domain = emailDomain(address)
  if (!domain) {
    return { status: 'unknown', reason: `Could not read a domain from "${address}"` }
  }

  return verifiedDomains.includes(domain) ? { status: 'authorized' } : { status: 'unauthorized', verifiedDomains }
}

export interface ChannelDriver {
  /** Stable identifier, also the `[provider]` route segment and `supportEmailEvent.provider`. */
  readonly name: string

  /**
   * Verify the request really came from the provider. Returns false rather
   * than throwing so the endpoint controls the response shape.
   */
  verifySignature(input: InboundVerificationInput): boolean

  /**
   * The provider's own id for this delivery, used as the idempotency key in
   * `supportEmailEvent (provider, providerEventId)`. Falls back to the RFC
   * Message-ID when the provider supplies no event id of its own; returns null
   * when neither exists, which the endpoint records as malformed.
   */
  extractEventId(payload: unknown): string | null

  /** Provider payload → normalized message. Throws on a payload it cannot read. */
  parse(payload: unknown): InboundMessage

  /**
   * Which credentials this driver is still missing. Stage 04 addition: the
   * driver is the only thing that knows what it needs (delta D-34).
   */
  isConfigured(): ChannelConfiguration

  /**
   * Whether the provider is authorized to send as `address`.
   *
   * Stage 04 addition. `supportInbox.emailAddress` is free text, so a team can
   * set a From the provider will reject - and per the stage doc that must be
   * caught in settings rather than silently at send time.
   */
  checkSendingAuthorization(address: string): Promise<SendingAuthorization>

  /**
   * The provider's own id for this delivery/bounce *event*, used as the
   * idempotency key in `supportDeliveryEvent (provider, providerEventId)`.
   *
   * Deliberately a different key space from `extractEventId`: that table is
   * keyed one row per *email* (a provider retry must not become a second
   * ticket), but one outbound message legitimately produces several delivery
   * events (Delivery, then Open, then possibly Bounce) - see "the delivery
   * webhook gets its own table" in `parallel-agents.md`. Falls back to a
   * composite of record type + message id + recipient when the provider
   * supplies no event id of its own (Postmark's Delivery payload may not).
   */
  extractDeliveryEventId(payload: unknown): string | null

  /**
   * Provider delivery/bounce webhook payload → normalized event. Throws on a
   * payload it cannot read.
   *
   * SUP-04-9 addition. Uses the same `verifySignature`/`isConfigured` as
   * inbound mail - both providers protect every webhook URL on an account the
   * same way (Postmark: Basic Auth in the URL; Mailgun: the HMAC envelope),
   * so there is nothing provider-specific left to verify differently here.
   */
  parseDeliveryEvent(payload: unknown): DeliveryEvent
}

/**
 * A normalized delivery, bounce, or engagement event for one previously-sent
 * message.
 *
 * **`messageId` is the single biggest unconfirmed assumption in Stage 04.**
 * It is read from whatever field the provider's delivery webhook uses to
 * identify the original message, on the assumption that it equals the RFC
 * `Message-ID` header this app set when sending (`conversationMessage.
 * channelMessageId`, stripped). That is true when sending through a
 * provider's HTTP send API, which returns and tracks against your own
 * Message-ID. It has NOT been verified for SMTP relay, which is what this
 * app actually uses (`lib/email.ts` → nodemailer → `SMTP_HOST`) - a provider
 * receiving mail over SMTP may instead track by an internal id of its own
 * that never appears in the RFC header at all, in which case this field will
 * not match anything and delivery-status tracking silently does nothing
 * (see the `messageId: null` handling in the endpoint, and D-35's precedent
 * for why "may legitimately never resolve" is handled as data, not an
 * error). Confirm against a real send before trusting this correlates.
 */
export interface DeliveryEvent {
  /** Provider-normalized: 'delivered' | 'bounced' | 'opened' | 'clicked' | 'spam_complaint'. */
  recordType: string
  /** RFC Message-ID this event is about, stripped. Null when the provider payload carries none. */
  messageId: string | null
  recipient: string | null
  /** Only meaningful when `recordType === 'bounced'`. */
  bounceType: 'hard' | 'soft' | null
  description: string | null
}

/** Strip the angle brackets RFC 5322 wraps message identifiers in. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^<|>$/g, '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Parse a `References` header into oldest → newest ids.
 *
 * Kept here rather than in a driver because every provider that exposes raw
 * headers needs it, and threading correctness depends on the ordering being
 * consistent across them.
 */
export function parseReferences(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/\s+/)
    .map((part) => normalizeMessageId(part))
    .filter((part): part is string => Boolean(part))
}

/** Lowercase every header name so downstream lookups are provider-agnostic. */
export function normalizeHeaders(headers: Record<string, unknown> | null | undefined): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (!headers) return normalized

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string') continue
    if (value === null || value === undefined) continue
    normalized[key.trim().toLowerCase()] = String(value)
  }

  return normalized
}
