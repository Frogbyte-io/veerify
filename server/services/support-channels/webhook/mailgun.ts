import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  normalizeHeaders,
  normalizeMessageId,
  parseReferences,
  type ChannelDriver,
  type InboundAddress,
  type InboundAttachment,
  type InboundMessage,
  type InboundVerificationInput,
} from '../types'

/**
 * Mailgun inbound webhook driver.
 *
 * Unlike Postmark, Mailgun does sign its webhooks: `signature` is
 * `HMAC-SHA256(timestamp + token)` keyed with the webhook signing key, hex
 * encoded. The three values arrive in the payload itself rather than in
 * headers.
 *
 * The timestamp is also checked against a freshness window. Without it a
 * captured payload replays forever, since the signature over a fixed
 * timestamp/token pair never expires on its own.
 */

const DEFAULT_TOLERANCE_SECONDS = 15 * 60

interface MailgunSignature {
  timestamp?: string | number
  token?: string
  signature?: string
}

interface MailgunAttachment {
  name?: string
  'content-type'?: string
  contentType?: string
  size?: number
  content?: string
  'content-id'?: string
  contentId?: string
}

// Deliberately does not extend MailgunSignature: `signature` is widened here
// to also carry the nested envelope form, which is not assignable to the flat
// `string` on the base interface.
interface MailgunInboundPayload {
  signature?: string | (MailgunSignature & { signature?: string })
  'Message-Id'?: string
  'message-id'?: string
  from?: string
  sender?: string
  recipient?: string
  To?: string
  Cc?: string
  subject?: string
  'body-plain'?: string
  'body-html'?: string
  'stripped-text'?: string
  'message-headers'?: [string, string][] | string
  timestamp?: string | number
  token?: string
  attachments?: MailgunAttachment[] | string
}

/**
 * Parse an RFC 5322 address list into normalized parts.
 *
 * Deliberately simple: it splits on commas outside quotes and angle brackets,
 * which covers the `Name <addr>` and bare-address forms providers emit. It is
 * not a full RFC parser, and group syntax is not supported.
 */
export function parseAddressList(value: string | null | undefined): InboundAddress[] {
  if (typeof value !== 'string' || !value.trim()) return []

  const parts: string[] = []
  let current = ''
  let inQuotes = false
  let inAngle = false

  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes
    if (char === '<') inAngle = true
    if (char === '>') inAngle = false
    if (char === ',' && !inQuotes && !inAngle) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)

  const addresses: InboundAddress[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const angled = trimmed.match(/^(.*)<([^>]+)>$/)
    const address = (angled ? angled[2] : trimmed).trim().toLowerCase()
    if (!address || !address.includes('@')) continue

    const name = angled ? angled[1].trim().replace(/^"|"$/g, '').trim() : ''
    addresses.push(name ? { address, name } : { address })
  }

  return addresses
}

function headersToRecord(value: MailgunInboundPayload['message-headers']): Record<string, string> {
  let entries: [string, string][] = []

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) entries = parsed as [string, string][]
    } catch {
      return {}
    }
  } else if (Array.isArray(value)) {
    entries = value
  }

  const raw: Record<string, unknown> = {}
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
    raw[entry[0]] = entry[1] ?? ''
  }
  return normalizeHeaders(raw)
}

function toAttachments(value: MailgunInboundPayload['attachments']): InboundAttachment[] {
  let list: MailgunAttachment[] = []

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) list = parsed
    } catch {
      return []
    }
  } else if (Array.isArray(value)) {
    list = value
  }

  return list.map((attachment) => {
    // Mailgun exposes attachments as URLs on the store() action; when content
    // is inlined it is base64. Fetching by URL is SUP-03-8's problem, so an
    // entry without inline content yields an empty buffer here rather than a
    // silent failure later.
    const content = Buffer.from(attachment.content ?? '', 'base64')
    const contentId = normalizeMessageId(attachment['content-id'] ?? attachment.contentId)
    return {
      fileName: (attachment.name ?? 'attachment').split(/[/\\]/).pop() || 'attachment',
      contentType: (attachment['content-type'] ?? attachment.contentType)?.trim() || null,
      content,
      size: content.byteLength || Number(attachment.size ?? 0) || 0,
      contentId,
      isInline: Boolean(contentId),
    }
  })
}

/** Pull the signing triple, which Mailgun sends either flat or nested. */
function readSignature(payload: MailgunInboundPayload | null): Required<MailgunSignature> | null {
  if (!payload) return null

  const nested = typeof payload.signature === 'object' && payload.signature !== null ? payload.signature : null
  const timestamp = nested?.timestamp ?? payload.timestamp
  const token = nested?.token ?? payload.token
  const signature = nested?.signature ?? (typeof payload.signature === 'string' ? payload.signature : undefined)

  if (timestamp === undefined || !token || !signature) return null
  return { timestamp: String(timestamp), token, signature }
}

export class MailgunChannelDriver implements ChannelDriver {
  readonly name = 'mailgun'

  private readonly signingKey: string
  private readonly toleranceSeconds: number

  constructor(options?: { signingKey?: string; toleranceSeconds?: number }) {
    this.signingKey = (options?.signingKey ?? process.env.SUPPORT_MAILGUN_SIGNING_KEY ?? '').trim()
    this.toleranceSeconds = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  }

  verifySignature(input: InboundVerificationInput): boolean {
    // Fail closed when unconfigured, as with every other driver.
    if (!this.signingKey) return false

    let payload: MailgunInboundPayload | null = null
    try {
      payload = JSON.parse(input.rawBody) as MailgunInboundPayload
    } catch {
      return false
    }

    const parts = readSignature(payload)
    if (!parts) return false

    const timestampSeconds = Number(parts.timestamp)
    if (!Number.isFinite(timestampSeconds)) return false

    // Reject stale payloads. A valid signature over an old timestamp is still
    // a valid signature, so replay protection has to come from here.
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds)
    if (ageSeconds > this.toleranceSeconds) return false

    const expected = createHmac('sha256', this.signingKey)
      .update(String(parts.timestamp) + parts.token)
      .digest('hex')

    const provided = Buffer.from(parts.signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')
    if (provided.length === 0 || provided.length !== expectedBuffer.length) return false

    return timingSafeEqual(provided, expectedBuffer)
  }

  extractEventId(payload: unknown): string | null {
    const typed = payload as MailgunInboundPayload | null
    // Mailgun's inbound routes carry no delivery id of their own, so the
    // Message-ID is the idempotency key. The signing token is deliberately not
    // used: it changes per retry, which would defeat duplicate suppression.
    const messageId = normalizeMessageId(typed?.['Message-Id'] ?? typed?.['message-id'])
    if (messageId) return messageId

    const headers = headersToRecord(typed?.['message-headers'])
    return normalizeMessageId(headers['message-id'])
  }

  parse(payload: unknown): InboundMessage {
    const typed = payload as MailgunInboundPayload | null
    if (!typed || typeof typed !== 'object') {
      throw new Error('Mailgun payload is not an object')
    }

    const headers = headersToRecord(typed['message-headers'])
    const from = parseAddressList(typed.from ?? typed.sender ?? headers.from)[0]
    if (!from) {
      throw new Error('Mailgun payload has no From address')
    }

    const to = parseAddressList(typed.To ?? typed.recipient ?? headers.to)
    const cc = parseAddressList(typed.Cc ?? headers.cc)

    const headerDate = headers.date ? new Date(headers.date) : null
    const timestampSeconds = Number(typed.timestamp)
    const timestampDate = Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1000) : null
    const receivedAt = [headerDate, timestampDate].find((d) => d && !Number.isNaN(d.getTime())) ?? new Date()

    return {
      messageId:
        normalizeMessageId(typed['Message-Id'] ?? typed['message-id']) ?? normalizeMessageId(headers['message-id']),
      inReplyTo: normalizeMessageId(headers['in-reply-to']),
      references: parseReferences(headers.references),
      from,
      to,
      cc,
      subject: typed.subject?.trim() || headers.subject?.trim() || null,
      // `stripped-text` is Mailgun's own quote removal. It is deliberately not
      // used: quote stripping is SUP-03-6's job and must behave identically
      // for every provider, so the driver hands over the full body.
      text: typed['body-plain'] ?? null,
      html: typed['body-html'] ?? null,
      attachments: toAttachments(typed.attachments),
      receivedAt,
      rawHeaders: headers,
    }
  }
}
