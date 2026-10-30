/**
 * Inbound channel adapter contract.
 *
 * Every provider driver normalizes its payload into `InboundMessage`.
 * **Nothing downstream may know which provider a message came from** — that is
 * the whole point of this boundary, and it is what lets IMAP re-enter later as
 * just another driver (delta D-29 dropped it as a polling channel, not as a
 * shape).
 *
 * `InboundMessage` is the normalized provider boundary consumed by threading,
 * quote-stripping, sanitization, and auto-response modules. Changing a field
 * here affects all of those consumers.
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
  /** Header recipients. Display and participant data only - routing prefers `envelopeRecipients`. */
  to: InboundAddress[]
  cc: InboundAddress[]
  /**
   * SMTP envelope recipients (RCPT TO) the provider delivered this copy to, in
   * the provider's order and de-duplicated. Empty when the provider does not
   * report a trustworthy envelope.
   *
   * Inbox routing uses these in preference to `to`/`cc`: Bcc'd, forwarded,
   * aliased and list mail reaches an inbox by envelope only, and routing on a
   * header the sender wrote could pick another tenant's inbox named there.
   */
  envelopeRecipients: InboundAddress[]
  subject: string | null
  text: string | null
  html: string | null
  attachments: InboundAttachment[]
  receivedAt: Date
  /** Header names lowercased, so lookups do not depend on provider casing. */
  rawHeaders: Record<string, string>
  /**
   * The provider's spam verdict says spam. A spam message opens its conversation
   * in the Spam folder and never triggers an auto-reply, SLA, automation or
   * reopen. False when the provider gives no verdict, and for "possibly spam"
   * (SES `GRAY`): only a definite verdict moves mail out of the inbox.
   */
  isSpam: boolean
  /**
   * Frogmail's `frogmail-forwards` (what the route's email forwards did with this message), validated.
   * Only read from the provider's top-level form field, never from sender headers. Absent otherwise.
   */
  frogmailForwards?: FrogmailForwardOutcome[]
  /** Frogmail's `frogmail-attachments-removed: true` (a virus verdict delivered the message without attachments). */
  attachmentsRemoved?: boolean
}

/** One entry of `frogmail-forwards`, keys as Frogmail sends them. */
export interface FrogmailForwardOutcome {
  destination: string
  destination_id: string | null
  /** `queued`, `skipped`, ... kept as sent (bounded length). */
  status: string
  /** Why a forward was skipped (`virus`, `spam`, `paused`, ...). */
  reason: string | null
  forward_id: string | null
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
  /** Parsed form fields, supplied for multipart providers whose body contains binary parts. */
  payload?: unknown
  /** Present only when the provider authenticates via HTTP Basic rather than a signature. */
  authorization?: string
}

/**
 * Which env vars a provider still needs. Names only, never values - the
 * channel card built in SUP-03-13 is visible to any project member.
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
  // Deliberately carries no domain list: the provider account is shared by every
  // project, so its domains must never reach a caller that can show them to a user.
  | { status: 'unauthorized' }
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

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '')
}

/**
 * The most specific verified domain `domain` sits on, or null.
 *
 * With `includeSubdomains`, a verified `example.com` also covers
 * `mail.example.com`, matched on a label boundary only - `badexample.com` is
 * not a subdomain of `example.com`. This mirrors how Mailgun-compatible
 * providers such as Frogmail authorize senders (most specific verified domain
 * wins); providers that only authorize the exact domain leave it off.
 */
export function matchVerifiedDomain(
  domain: string,
  verifiedDomains: string[],
  options: { includeSubdomains?: boolean } = {}
): string | null {
  const target = normalizeDomain(domain)
  if (!target) return null

  let best: string | null = null
  for (const candidate of verifiedDomains.map(normalizeDomain)) {
    if (!candidate) continue
    const matches = target === candidate || (options.includeSubdomains === true && target.endsWith(`.${candidate}`))
    if (matches && (best === null || candidate.length > best.length)) best = candidate
  }
  return best
}

/**
 * Shared verdict logic: does `address` sit on one of `verifiedDomains`?
 *
 * Both providers differ only in how they report their domain list, so the
 * comparison itself is kept in one place - a case-sensitivity slip here would
 * warn about a perfectly good From address.
 */
export function authorizationForDomains(
  address: string,
  verifiedDomains: string[],
  options: { includeSubdomains?: boolean } = {}
): SendingAuthorization {
  const domain = emailDomain(address)
  if (!domain) {
    return { status: 'unknown', reason: `Could not read a domain from "${address}"` }
  }

  return matchVerifiedDomain(domain, verifiedDomains, options) ? { status: 'authorized' } : { status: 'unauthorized' }
}

export interface ChannelDriver {
  /** Stable identifier, also the `[provider]` route segment and `supportEmailEvent.provider`. */
  readonly name: string

  /** Non-secret deployment identity used to isolate delivery webhook keys. */
  readonly accountKey: string

  /**
   * Whether the provider authorizes a verified domain's subdomains as senders
   * (Mailgun/Frogmail yes, Postmark no). Project-scoped enforcement needs this.
   */
  readonly authorizesSubdomains: boolean

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
   * Stage 04 addition. `supportInbox.emailAddress` is free text, so a project can
   * set a From the provider will reject - and per the stage doc that must be
   * caught in settings rather than silently at send time.
   */
  checkSendingAuthorization(address: string): Promise<SendingAuthorization>

  /** Provider-specific metadata headers that carry the durable outbox key. */
  buildDeliveryCorrelationHeaders(correlationKey: string): Record<string, string>

  /**
   * The provider's own id for this delivery/bounce *event*, used as the
   * idempotency key in `supportDeliveryEvent (provider, providerEventId)`.
   *
   * Deliberately a different key space from `extractEventId`: that table is
   * keyed one row per *email* (a provider retry must not become a second
   * ticket), but one outbound message legitimately produces several delivery
   * events (Delivery, then Open, then possibly Bounce) - see "the delivery
   * webhook gets its own table. Falls back to a
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
 * Correlation identity is deliberately split into the durable application
 * key, provider account, and provider message id. None of these fields is an
 * RFC Message-ID, and the delivery route never compares them with
 * `conversationMessage.channelMessageId`.
 */
export interface DeliveryEvent {
  providerEventId: string | null
  providerAccountKey: string
  correlationKey: string | null
  providerMessageId: string | null
  /**
   * The RFC 5322 Message-ID the provider reports the message went out with,
   * angle brackets stripped, when the provider exposes one: Frogmail's
   * `event-data.frogmail.provider-message-id`, else Mailgun's
   * `event-data.message.headers.message-id` (Mailgun keeps the sent id). Null
   * for providers whose ids are not RFC Message-IDs (Postmark).
   *
   * Unlike the correlation fields above this IS a Message-ID: when it differs
   * from the one Veerify generated (a relay such as SES rewrote it), it is
   * stored as `conversationMessage.providerChannelMessageId` so a reply that
   * only references the rewritten id still threads. Never used to resolve
   * which message an event belongs to.
   */
  rfcMessageId: string | null
  /** Provider-normalized: 'delivered' | 'bounced' | 'opened' | 'clicked' | 'spam_complaint'. */
  recordType: string
  recipient: string | null
  occurredAt: Date
  error: string | null
  /** Only meaningful when `recordType === 'bounced'`. */
  bounceType: 'hard' | 'soft' | null
  description: string | null
  /**
   * Frogmail forward delivery event (tag `frogmail-forward`): not a support delivery. The webhook only
   * stamps `last_event_at` on the destination named by `forwardDestinationId` and records nothing else.
   */
  isForward?: boolean
  forwardDestinationId?: string | null
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
