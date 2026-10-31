import type { Readable } from 'node:stream'
import type { EmailAddress, SendEmailOptions, SendEmailResult } from '~/lib/email'
import { emailDomain, type FetchImpl } from '~/server/services/support-channels/types'
import { sanitizeProviderMessage } from '~/server/services/sending-domains/util'
import { createLogger } from '~/server/utils/logger'
import { isSenderRefusalText } from '~/lib/support-delivery-errors'

const logger = createLogger('support-mail-transport')

/**
 * How the support outbox hands a reply to the provider (`SUPPORT_SEND_TRANSPORT`).
 *
 * - `smtp` (default): `sendEmail({ channel: 'support' })` over the primary
 *   `SMTP_*` transport, exactly as before.
 * - `mailgun`: `POST /v3/{domain}/messages` on the Mailgun-compatible HTTP API
 *   (Mailgun or Frogmail) at `SUPPORT_MAILGUN_API_BASE_URL`. Lets support mail
 *   go out through Frogmail, where customer domains are verified, while system
 *   mail stays on an SMTP provider (e.g. Resend) that only knows Veerify's own
 *   domain.
 *
 * Only the support outbox reads this; system mail never does.
 */
export type SupportSendTransport =
  | { transport: 'smtp' }
  | { transport: 'mailgun'; apiKey: string; apiBaseUrl: string; usesSharedKey: boolean }
  /** Selected but unusable: the delivery fails (and retries) rather than quietly falling back to SMTP. */
  | { transport: 'misconfigured'; error: string }

type Env = Record<string, string | undefined>

const DEFAULT_API_BASE_URL = 'https://api.mailgun.net'
/** Generous: a reply may carry up to 25 MB of attachments. */
const REQUEST_TIMEOUT_MS = 60_000
/** Frogmail's limit on one `h:` header value (RFC 5322's line limit). */
const MAX_HEADER_VALUE_LENGTH = 998

/**
 * Headers the provider refuses as `h:` fields or that have a dedicated field.
 * Message-ID is reserved on Frogmail (400) and assigned by the provider, which
 * returns it as `id`; Reply-To travels as `h:Reply-To` from `replyTo`.
 */
const SKIPPED_HEADERS = new Set(['message-id', 'reply-to'])

/** Empty and whitespace-only values mean unset, as compose files emit `VAR=` for unused settings. */
function envValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

/** Read at send time, like `resolveMailTransportConfig`, so a prebuilt image switches with an env change. */
export function resolveSupportSendTransport(env: Env = process.env as Env): SupportSendTransport {
  const selected = (envValue(env, 'SUPPORT_SEND_TRANSPORT') ?? 'smtp').toLowerCase()
  if (selected === 'smtp') return { transport: 'smtp' }
  if (selected !== 'mailgun') {
    return {
      transport: 'misconfigured',
      error: `SUPPORT_SEND_TRANSPORT must be "smtp" or "mailgun", not "${selected.slice(0, 40)}"`,
    }
  }

  const sendKey = envValue(env, 'SUPPORT_MAILGUN_SEND_API_KEY')
  const sharedKey = envValue(env, 'SUPPORT_MAILGUN_API_KEY')
  const apiKey = sendKey ?? sharedKey
  if (!apiKey) {
    return {
      transport: 'misconfigured',
      error: 'SUPPORT_SEND_TRANSPORT=mailgun needs SUPPORT_MAILGUN_SEND_API_KEY (or SUPPORT_MAILGUN_API_KEY)',
    }
  }

  // Validated here so a typo fails every delivery with a clear error rather
  // than fetch's generic "Failed to parse URL".
  const apiBaseUrl = (envValue(env, 'SUPPORT_MAILGUN_API_BASE_URL') ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+$/i.test(apiBaseUrl)) {
    return {
      transport: 'misconfigured',
      error: 'SUPPORT_MAILGUN_API_BASE_URL must be an origin such as https://frogmail.example.com (no path)',
    }
  }

  return { transport: 'mailgun', apiKey, apiBaseUrl, usesSharedKey: !sendKey }
}

let warnedAboutSharedKey = false

/** Once per process: the fallback works, but sending then shares the domain poller's per-key rate limit. */
export function warnOnceAboutSharedSendKey(): void {
  if (warnedAboutSharedKey) return
  warnedAboutSharedKey = true
  logger.warn(
    'SUPPORT_MAILGUN_SEND_API_KEY is not set; support replies use SUPPORT_MAILGUN_API_KEY, which then needs ' +
      'the emails:send scope and shares its rate limit with domain polling. See docs/deployment-mail.md.'
  )
}

/** Test seam for the once-only warning. */
export function resetSharedSendKeyWarning(): void {
  warnedAboutSharedKey = false
}

function formatAddress(address: EmailAddress): string {
  if (!address.name) return address.address
  return `"${address.name.replace(/["\\]/g, '\\$&')}" <${address.address}>`
}

/**
 * Fit a References value into one header line, keeping the root and the most
 * recent ids - the same trimming `buildReferences` applies by count. SMTP
 * folds long headers; the HTTP API refuses values over 998 characters, and a
 * 50-entry chain is well over that.
 */
export function fitReferences(value: string, maxLength = MAX_HEADER_VALUE_LENGTH): string {
  if (value.length <= maxLength) return value
  const ids = value.split(/\s+/).filter(Boolean)
  if (ids.length === 0) return ''

  const root = ids[0]
  const tail: string[] = []
  let length = root.length
  for (let i = ids.length - 1; i > 0; i--) {
    if (length + 1 + ids[i].length > maxLength) break
    tail.unshift(ids[i])
    length += 1 + ids[i].length
  }
  return root.length > maxLength ? '' : [root, ...tail].join(' ')
}

async function attachmentBytes(content: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(content)) return content
  const chunks: Buffer[] = []
  for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/**
 * The multipart form for `POST /v3/{domain}/messages`, Mailgun field names:
 *
 * - `to` and `cc` repeated per address (Frogmail parses repeated plain names);
 * - every custom header as `h:<Name>`, except Message-ID (provider-assigned,
 *   returned as `id`); `In-Reply-To`/`References` thread the message, and
 *   `h:X-Mailgun-Variables` becomes the user variables echoed on delivery
 *   webhooks as `user-variables`, exactly as the SMTP header does;
 * - attachments as `attachment`, and those with a `cid` as `inline` named by
 *   the cid, since Mailgun and Frogmail resolve `cid:<filename>` references.
 *
 * Field order is deterministic, so a retry under the same `Idempotency-Key`
 * fingerprints identically on Frogmail.
 */
export async function buildMailgunMessageForm(options: SendEmailOptions, from: string): Promise<FormData> {
  const form = new FormData()
  form.append('from', from)
  for (const to of Array.isArray(options.to) ? options.to : [options.to]) form.append('to', to)
  for (const cc of options.cc ?? []) form.append('cc', cc)
  form.append('subject', options.subject)
  // Same defaults as `buildMailPayload`, so both transports send the same bodies.
  form.append('text', options.text || 'Hello from Veerify!')
  form.append('html', options.html || `<p>${options.text || 'Hello from Veerify!'}</p>`)
  if (options.replyTo) form.append('h:Reply-To', options.replyTo)

  for (const [name, rawValue] of Object.entries(options.headers ?? {})) {
    const lower = name.trim().toLowerCase()
    if (SKIPPED_HEADERS.has(lower)) continue
    const value = lower === 'references' ? fitReferences(rawValue) : rawValue
    if (value) form.append(`h:${name.trim()}`, value)
  }

  for (const attachment of options.attachments ?? []) {
    const bytes = await attachmentBytes(attachment.content)
    const blob = new Blob([new Uint8Array(bytes)], { type: attachment.contentType || 'application/octet-stream' })
    if (attachment.cid) form.append('inline', blob, attachment.cid.replace(/^<|>$/g, ''))
    else form.append('attachment', blob, attachment.filename)
  }

  return form
}

/** The `{"message": ...}` of a Mailgun-style error, or the raw text. */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed?.message === 'string') return parsed.message
  } catch {
    // Not JSON: Frogmail's 401 is plain-text `Forbidden`.
  }
  return body
}

/**
 * Whether an error response says the provider will not send as this From:
 * the path domain is not a verified domain of the key's project (`404 Domain
 * not found`, `400 Domain … is not verified for sending yet`), the sender
 * itself is refused (`400 The sender domain …`), or the body or
 * `X-Frogmail-Error` carries the code `sender_not_authorized` (any 4xx).
 */
export function isSenderRefusal(status: number, message: string, code: string | null = null): boolean {
  if (status < 400 || status >= 500 || status === 429) return false
  if (code?.trim().toLowerCase() === 'sender_not_authorized') return true
  if (status === 404) return /^domain not found/i.test(message.trim())
  return /sender domain|not verified for sending/i.test(message) || isSenderRefusalText(message)
}

/** `code` of a JSON error body (Frogmail's native and policy errors carry one). */
function errorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    return typeof parsed?.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

export interface MailgunSendDeps {
  fetchImpl?: FetchImpl
  timeoutMs?: number
  /** Default From when the message carries none, as nodemailer falls back to MAIL_FROM. */
  defaultFrom?: string
}

/**
 * Send one support message over the Mailgun-compatible HTTP API.
 *
 * Returns the `SendEmailResult` contract of `sendEmail`, so the outbox treats
 * both transports alike: a sender refusal is reported with
 * `sender_not_authorized` so `isProviderSenderRejection` fails it terminally;
 * every other failure (other 4xx, 429, 5xx, network, timeout) is a retryable
 * non-terminal failure, matching the SMTP path. The API key never appears in
 * a returned or logged message.
 */
export async function sendSupportEmailViaMailgun(
  options: SendEmailOptions,
  config: { apiKey: string; apiBaseUrl: string },
  deps: MailgunSendDeps = {}
): Promise<SendEmailResult> {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const defaultFrom = deps.defaultFrom ?? (process.env.NUXT_NODEMAILER_FROM?.trim() || process.env.MAIL_FROM?.trim())
  const from = options.from ? formatAddress(options.from) : defaultFrom
  const fromAddress = options.from?.address ?? from?.match(/<([^<>]+)>\s*$/)?.[1] ?? from
  const domain = fromAddress ? emailDomain(fromAddress) : null
  if (!from || !domain) {
    return { accepted: false, response: 'Mailgun send needs a From address (set MAIL_FROM)' }
  }

  // The outbox's durable key: Frogmail replays the original id for a repeated
  // key instead of sending twice, which covers a timeout after acceptance.
  const idempotencyKey = Object.entries(options.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'x-veerify-idempotency-key'
  )?.[1]

  const redact = (text: string) => sanitizeProviderMessage(text, [config.apiKey], 300)
  let response: Response
  try {
    response = await fetchImpl(`${config.apiBaseUrl}/v3/${encodeURIComponent(domain)}/messages`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: await buildMailgunMessageForm(options, from),
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      accepted: false,
      response: redact(`Mailgun API request failed: ${error instanceof Error ? error.message : String(error)}`),
    }
  }

  const body = await response.text().catch(() => '')

  if (response.ok) {
    let id: unknown
    try {
      id = (JSON.parse(body) as { id?: unknown })?.id
    } catch {
      id = undefined
    }
    // Stored without angle brackets, like `parseSubmissionMessageId`'s SMTP id
    // and the `message-id` delivery webhooks report.
    const providerMessageId = typeof id === 'string' ? id.trim().replace(/^<|>$/g, '').trim() : ''
    return {
      accepted: true,
      ...(providerMessageId ? { providerMessageId } : {}),
      response: `${response.status} ${redact(errorMessage(body)) || 'Queued'}`,
    }
  }

  const message = redact(errorMessage(body))
  // Frogmail's 401 body is just `Forbidden`; the reason is in this header.
  const reason = response.headers.get('x-frogmail-error')
  const detail = `Mailgun API returned ${response.status}${reason ? ` (${redact(reason)})` : ''}: ${message || 'no message'}`
  return {
    accepted: false,
    response: isSenderRefusal(response.status, message, reason ?? errorCode(body))
      ? `sender_not_authorized: ${detail}`
      : detail,
  }
}

/**
 * The send function the outbox uses for support mail, chosen by
 * `SUPPORT_SEND_TRANSPORT` at call time. `smtpSend` is `sendEmail` in
 * production; it is a parameter so this module never imports nodemailer.
 */
export function createSupportSendEmail(
  smtpSend: (options: SendEmailOptions) => Promise<SendEmailResult>,
  deps: MailgunSendDeps & { env?: Env } = {}
): (options: SendEmailOptions) => Promise<SendEmailResult> {
  return async (options) => {
    const selected = resolveSupportSendTransport(deps.env)
    if (selected.transport === 'smtp') return smtpSend(options)
    if (selected.transport === 'misconfigured') {
      logger.error('Support mail transport is misconfigured', { error: selected.error })
      return { accepted: false, response: selected.error }
    }
    if (selected.usesSharedKey) warnOnceAboutSharedSendKey()
    return sendSupportEmailViaMailgun(options, selected, deps)
  }
}
