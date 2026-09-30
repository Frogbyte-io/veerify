/**
 * Realtime transport contract.
 *
 * Events are deliberately thin: they carry identifiers only, never record
 * contents. Clients refetch through the normal authorized endpoints. This means
 * a subscription bug can leak the existence of an id but never another tenant's
 * ticket contents — see `docs/plans/2026-08-11-support-platform/design.md`.
 */

/** Bumped only when the envelope shape changes incompatibly. */
export const REALTIME_ENVELOPE_VERSION = 1

/**
 * The only fields an envelope may carry. `sanitizeEnvelope` strips everything
 * else, so a future caller cannot smuggle a message body through the broker.
 */
export const REALTIME_ENVELOPE_FIELDS = [
  'v',
  'type',
  'teamId',
  'userId',
  'inboxId',
  'conversationId',
  'messageId',
] as const

export interface RealtimeEnvelope {
  /** Envelope version. A deploy leaves old and new instances running side by side. */
  v: number
  /** Dot-namespaced event name, e.g. `conversation.updated`. */
  type: string
  /**
   * Scope identifiers. At least one is required, and it must match the channel
   * the envelope is published on — see `envelopeMatchesChannel`.
   *
   * `teamId` is not universally mandatory: a `user:<id>` event is scoped by the
   * user, who may belong to several teams, so demanding a team there would be
   * meaningless. The invariant is "every envelope is scoped", not "every
   * envelope has a teamId".
   */
  teamId?: string
  userId?: string
  inboxId?: string
  conversationId?: string
  messageId?: string
}

export type RealtimeHandler = (envelope: RealtimeEnvelope, channel: string) => void

export interface RealtimeDriver {
  readonly name: string
  publish(channel: string, envelope: RealtimeEnvelope): Promise<void>
  subscribe(channel: string, handler: RealtimeHandler): Promise<void>
  unsubscribe(channel: string, handler: RealtimeHandler): Promise<void>
  close(): Promise<void>
}

/* -------------------------------------------------------------------------- */
/* Channels                                                                    */
/* -------------------------------------------------------------------------- */

export type RealtimeChannelScope = 'team' | 'inbox' | 'conversation' | 'user'

const CHANNEL_SCOPES: RealtimeChannelScope[] = ['team', 'inbox', 'conversation', 'user']

export function teamChannel(teamId: string): string {
  return `team:${teamId}`
}

export function inboxChannel(inboxId: string): string {
  return `inbox:${inboxId}`
}

export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`
}

export function userChannel(userId: string): string {
  return `user:${userId}`
}

/**
 * Split a channel name into its scope and id. Returns null for anything that is
 * not a well-formed channel, so callers can reject rather than guess.
 */
export function parseChannel(channel: string): { scope: RealtimeChannelScope; id: string } | null {
  if (typeof channel !== 'string') return null
  const separator = channel.indexOf(':')
  if (separator <= 0) return null

  const scope = channel.slice(0, separator) as RealtimeChannelScope
  const id = channel.slice(separator + 1)

  if (!CHANNEL_SCOPES.includes(scope)) return null
  if (!id) return null

  return { scope, id }
}

/* -------------------------------------------------------------------------- */
/* Envelope handling                                                           */
/* -------------------------------------------------------------------------- */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Coerce untrusted input into a valid envelope, or return null.
 *
 * Unknown keys are dropped rather than passed through. That is the enforcement
 * point for "envelopes carry no record contents" — it holds even if a caller
 * elsewhere tries to attach a payload.
 *
 * Envelopes with a version higher than this instance knows are still delivered
 * with their known fields, because during a deploy a newer instance will publish
 * to older subscribers.
 */
export function sanitizeEnvelope(input: unknown): RealtimeEnvelope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const raw = input as Record<string, unknown>

  if (typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) return null
  if (!isNonEmptyString(raw.type)) return null

  const envelope: RealtimeEnvelope = {
    v: raw.v,
    type: raw.type,
  }

  if (isNonEmptyString(raw.teamId)) envelope.teamId = raw.teamId
  if (isNonEmptyString(raw.userId)) envelope.userId = raw.userId
  if (isNonEmptyString(raw.inboxId)) envelope.inboxId = raw.inboxId
  if (isNonEmptyString(raw.conversationId)) envelope.conversationId = raw.conversationId
  if (isNonEmptyString(raw.messageId)) envelope.messageId = raw.messageId

  // An unscoped envelope has nothing to authorize against and nothing to route
  // by, so it is rejected outright rather than delivered to whoever happens to
  // be listening.
  if (!envelope.teamId && !envelope.userId && !envelope.inboxId && !envelope.conversationId) {
    return null
  }

  return envelope
}

/**
 * Does this envelope belong on this channel?
 *
 * Checked at publish time. Without it, nothing stops a `team:A` event being
 * published to `team:B` — subscribe-time authorization proves a listener may
 * hear channel B, not that the payload was ever meant for it. Both halves are
 * needed for tenant isolation to actually hold.
 */
export function envelopeMatchesChannel(envelope: RealtimeEnvelope, channel: string): boolean {
  const parsed = parseChannel(channel)
  if (!parsed) return false

  switch (parsed.scope) {
    case 'team':
      return envelope.teamId === parsed.id
    case 'user':
      return envelope.userId === parsed.id
    case 'inbox':
      return envelope.inboxId === parsed.id
    case 'conversation':
      return envelope.conversationId === parsed.id
    default:
      return false
  }
}

/** Parse a wire message. Returns null on malformed JSON or an invalid envelope. */
export function parseEnvelope(message: string): RealtimeEnvelope | null {
  try {
    return sanitizeEnvelope(JSON.parse(message))
  } catch {
    return null
  }
}

/** Build an envelope at the current version, dropping any stray fields. */
export function createEnvelope(input: Omit<RealtimeEnvelope, 'v'> & { v?: number }): RealtimeEnvelope {
  const envelope = sanitizeEnvelope({ ...input, v: input.v ?? REALTIME_ENVELOPE_VERSION })
  if (!envelope) {
    throw new Error(
      'Invalid realtime envelope: `type` is required, plus at least one scope id (teamId, userId, inboxId, or conversationId)'
    )
  }
  return envelope
}
