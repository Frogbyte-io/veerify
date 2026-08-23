import { timingSafeEqual } from 'node:crypto'
import {
  authorizationForDomains,
  normalizeHeaders,
  normalizeMessageId,
  parseReferences,
  type ChannelConfiguration,
  type DeliveryEvent,
  type FetchImpl,
  type SendingAuthorization,
  type ChannelDriver,
  type InboundAddress,
  type InboundAttachment,
  type InboundMessage,
  type InboundVerificationInput,
} from '../types'

/**
 * Postmark inbound webhook driver.
 *
 * **Postmark does not sign inbound webhooks.** Its documented protection is
 * HTTP Basic Auth credentials embedded in the webhook URL, combined with IP
 * allowlisting — there is no HMAC header to verify, unlike Mailgun. So
 * `verifySignature` here is a constant-time credential check rather than a
 * digest check. The `ChannelDriver` method name is kept for the shared
 * contract; the asymmetry is real and is flagged in TODO.md.
 *
 * Configure `SUPPORT_POSTMARK_WEBHOOK_USER` / `SUPPORT_POSTMARK_WEBHOOK_PASSWORD`
 * and give Postmark the URL `https://user:password@host/api/support/inbound/postmark`.
 */

interface PostmarkAddress {
  Email?: string
  Name?: string
}

interface PostmarkHeader {
  Name?: string
  Value?: string
}

interface PostmarkAttachment {
  Name?: string
  Content?: string
  ContentType?: string
  ContentLength?: number
  ContentID?: string
}

interface PostmarkInboundPayload {
  MessageID?: string
  FromFull?: PostmarkAddress
  From?: string
  ToFull?: PostmarkAddress[]
  CcFull?: PostmarkAddress[]
  Subject?: string
  TextBody?: string
  HtmlBody?: string
  Date?: string
  Headers?: PostmarkHeader[]
  Attachments?: PostmarkAttachment[]
}

/**
 * Delivery, Bounce, Open, Click, and SpamComplaint webhooks all land on the
 * same URL when configured together, discriminated by `RecordType`. Only
 * `Bounce` records carry a dedicated numeric `ID`; the others fall back to a
 * composite key in `extractDeliveryEventId`.
 */
interface PostmarkDeliveryPayload {
  RecordType?: string
  MessageID?: string
  ID?: number
  Recipient?: string
  Email?: string
  Type?: string
  Description?: string
}

/** Postmark's own transient/retryable bounce types - Type values not in this set are treated as hard. */
const SOFT_BOUNCE_TYPES = new Set(['softbounce', 'transient'])

/**
 * `SoftBounce`/`Transient` are the only Postmark bounce types documented as
 * retryable; anything else (including types this driver does not
 * specifically recognize) defaults to hard. design.md's own stated priority
 * is "silent delivery failure is worse than a visible error", so an
 * ambiguous bounce record surfaces rather than being swallowed as soft.
 */
function classifyPostmarkBounce(type: string | undefined): 'hard' | 'soft' {
  const normalized = (type ?? '').trim().toLowerCase()
  return SOFT_BOUNCE_TYPES.has(normalized) ? 'soft' : 'hard'
}

const RECORD_TYPE_MAP: Record<string, string> = {
  Delivery: 'delivered',
  Bounce: 'bounced',
  Open: 'opened',
  Click: 'clicked',
  SpamComplaint: 'spam_complaint',
}

/** Constant-time string compare that tolerates unequal lengths. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, so the length check has to
  // happen first. Length is not the secret here; the credential is.
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function toAddress(value: PostmarkAddress | undefined): InboundAddress | null {
  const address = value?.Email?.trim().toLowerCase()
  if (!address) return null
  const name = value?.Name?.trim()
  return name ? { address, name } : { address }
}

function toAddressList(values: PostmarkAddress[] | undefined): InboundAddress[] {
  if (!Array.isArray(values)) return []
  return values.map(toAddress).filter((entry): entry is InboundAddress => entry !== null)
}

function headersToRecord(headers: PostmarkHeader[] | undefined): Record<string, string> {
  if (!Array.isArray(headers)) return {}
  const raw: Record<string, unknown> = {}
  for (const header of headers) {
    if (typeof header?.Name !== 'string') continue
    raw[header.Name] = header.Value ?? ''
  }
  return normalizeHeaders(raw)
}

function toAttachments(values: PostmarkAttachment[] | undefined): InboundAttachment[] {
  if (!Array.isArray(values)) return []

  return values.map((attachment) => {
    const content = Buffer.from(attachment.Content ?? '', 'base64')
    const contentId = normalizeMessageId(attachment.ContentID)
    return {
      // Basename only: a provider-supplied name is untrusted input and must
      // never be able to escape the storage prefix it is written under.
      fileName: (attachment.Name ?? 'attachment').split(/[/\\]/).pop() || 'attachment',
      contentType: attachment.ContentType?.trim() || null,
      content,
      // Trust the decoded length over the declared one.
      size: content.byteLength,
      contentId,
      // Postmark marks inline parts by giving them a Content-ID.
      isInline: Boolean(contentId),
    }
  })
}

export class PostmarkChannelDriver implements ChannelDriver {
  readonly name = 'postmark'

  private readonly user: string
  private readonly password: string
  private readonly apiToken: string
  private readonly fetchImpl: FetchImpl

  constructor(credentials?: {
    user?: string
    password?: string
    /**
     * Postmark's ACCOUNT token, not a server token - `/domains` is an
     * account-level endpoint and a server token returns 401 there. Named
     * explicitly so an operator does not paste the wrong one and read the
     * resulting `unknown` as "the check is broken".
     */
    apiToken?: string
    fetchImpl?: FetchImpl
  }) {
    this.user = (credentials?.user ?? process.env.SUPPORT_POSTMARK_WEBHOOK_USER ?? '').trim()
    this.password = (credentials?.password ?? process.env.SUPPORT_POSTMARK_WEBHOOK_PASSWORD ?? '').trim()
    this.apiToken = (credentials?.apiToken ?? process.env.SUPPORT_POSTMARK_ACCOUNT_TOKEN ?? '').trim()
    this.fetchImpl = credentials?.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  isConfigured(): ChannelConfiguration {
    const missing: string[] = []
    if (!this.user) missing.push('SUPPORT_POSTMARK_WEBHOOK_USER')
    if (!this.password) missing.push('SUPPORT_POSTMARK_WEBHOOK_PASSWORD')

    return { configured: missing.length === 0, missing }
  }

  async checkSendingAuthorization(address: string): Promise<SendingAuthorization> {
    if (!this.apiToken) {
      return { status: 'unknown', reason: 'Set SUPPORT_POSTMARK_ACCOUNT_TOKEN to verify sending domains' }
    }

    let verified: string[]
    try {
      const response = await this.fetchImpl('https://api.postmarkapp.com/domains?count=500&offset=0', {
        headers: { Accept: 'application/json', 'X-Postmark-Account-Token': this.apiToken },
      })

      if (!response.ok) {
        // Deliberately not 'unauthorized': a 500 from Postmark says nothing
        // about whether the address is allowed.
        return { status: 'unknown', reason: `Postmark returned ${response.status}` }
      }

      const body = (await response.json()) as {
        Domains?: { Name?: string; DKIMVerified?: boolean; ReturnPathDomainVerified?: boolean }[]
      }

      verified = (body.Domains ?? [])
        // A domain can be listed on the account without having passed DKIM.
        // Sending as one of those fails at send time, which is the failure
        // this check exists to pre-empt, so listed-but-unverified is not
        // authorization.
        .filter((domain) => domain.DKIMVerified && domain.ReturnPathDomainVerified)
        .map((domain) => (domain.Name ?? '').trim().toLowerCase())
        .filter((name) => name.length > 0)
    } catch (error) {
      return { status: 'unknown', reason: error instanceof Error ? error.message : 'Postmark lookup failed' }
    }

    return authorizationForDomains(address, verified)
  }

  verifySignature(input: InboundVerificationInput): boolean {
    // Fail closed when unconfigured. An empty credential must never mean
    // "accept anything" on a publicly reachable intake endpoint.
    if (!this.user || !this.password) return false

    const header = input.authorization ?? input.headers.authorization ?? ''
    const prefix = 'Basic '
    if (!header.startsWith(prefix)) return false

    let decoded: string
    try {
      decoded = Buffer.from(header.slice(prefix.length).trim(), 'base64').toString('utf8')
    } catch {
      return false
    }

    const separator = decoded.indexOf(':')
    if (separator < 0) return false

    // Compare both halves unconditionally rather than short-circuiting on the
    // username, so a wrong username and a wrong password cost the same.
    const userMatches = safeEqual(decoded.slice(0, separator), this.user)
    const passwordMatches = safeEqual(decoded.slice(separator + 1), this.password)

    return userMatches && passwordMatches
  }

  extractEventId(payload: unknown): string | null {
    const typed = payload as PostmarkInboundPayload | null
    return normalizeMessageId(typed?.MessageID)
  }

  parse(payload: unknown): InboundMessage {
    const typed = payload as PostmarkInboundPayload | null
    if (!typed || typeof typed !== 'object') {
      throw new Error('Postmark payload is not an object')
    }

    const from = toAddress(typed.FromFull) ?? (typed.From ? { address: typed.From.trim().toLowerCase() } : null)
    if (!from) {
      throw new Error('Postmark payload has no From address')
    }

    const headers = headersToRecord(typed.Headers)
    const parsedDate = typed.Date ? new Date(typed.Date) : null

    return {
      messageId: normalizeMessageId(typed.MessageID) ?? normalizeMessageId(headers['message-id']),
      inReplyTo: normalizeMessageId(headers['in-reply-to']),
      references: parseReferences(headers.references),
      from,
      to: toAddressList(typed.ToFull),
      cc: toAddressList(typed.CcFull),
      subject: typed.Subject?.trim() || null,
      text: typed.TextBody ?? null,
      html: typed.HtmlBody ?? null,
      attachments: toAttachments(typed.Attachments),
      // An unparseable provider date must not become an Invalid Date on the
      // message row; fall back to arrival time.
      receivedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(),
      rawHeaders: headers,
    }
  }

  extractDeliveryEventId(payload: unknown): string | null {
    const typed = payload as PostmarkDeliveryPayload | null
    if (!typed || typeof typed !== 'object') return null

    // Only Bounce records carry a dedicated event id. Delivery/Open/Click/
    // SpamComplaint do not document one, so a composite of everything that
    // identifies this specific event stands in - matching the reasoning
    // question 1 in parallel-agents.md settled for the table's key shape.
    //
    // `typed.ID` is already a JS number by the time it reaches here (parsed
    // upstream by `readBody`/`JSON.parse`), so a bounce id beyond
    // `Number.MAX_SAFE_INTEGER` would already have lost precision before this
    // function runs - not fixable at this layer. Not independently confirmed
    // whether real Postmark bounce ids ever reach that magnitude.
    if (typeof typed.ID === 'number') return `postmark-bounce-${typed.ID}`

    const messageId = normalizeMessageId(typed.MessageID)
    const recipient = (typed.Recipient ?? typed.Email ?? '').trim().toLowerCase()
    if (!messageId || !recipient) return null

    return `${typed.RecordType ?? 'unknown'}:${messageId}:${recipient}`
  }

  parseDeliveryEvent(payload: unknown): DeliveryEvent {
    const typed = payload as PostmarkDeliveryPayload | null
    if (!typed || typeof typed !== 'object') {
      throw new Error('Postmark delivery payload is not an object')
    }

    const recordType = RECORD_TYPE_MAP[typed.RecordType ?? ''] ?? (typed.RecordType ?? 'unknown').toLowerCase()

    return {
      recordType,
      messageId: normalizeMessageId(typed.MessageID),
      recipient: (typed.Recipient ?? typed.Email ?? '').trim().toLowerCase() || null,
      bounceType: recordType === 'bounced' ? classifyPostmarkBounce(typed.Type) : null,
      description: typed.Description?.trim() || null,
    }
  }
}
