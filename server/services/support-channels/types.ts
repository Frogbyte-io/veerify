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
