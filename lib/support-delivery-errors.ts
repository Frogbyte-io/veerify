/**
 * Plain-language reasons for a support reply that failed or bounced. The thread
 * API returns the reason code (`failureReason`) next to the raw, sanitized
 * provider text (`deliveryError`); the UI shows the sentence and keeps the raw
 * text behind a "Details" disclosure.
 */

export type DeliveryFailureReason =
  | 'sender_rejected'
  | 'recipient_rejected'
  | 'mailbox_full'
  | 'provider_unavailable'
  | 'configuration'
  | 'abandoned'
  | 'unknown'

/** Outbox marker for a send refused because the From is not authorized (local check or provider refusal). */
export const SENDER_DOMAIN_NOT_AUTHORIZED = 'SENDER_DOMAIN_NOT_AUTHORIZED'

/** Outbox marker for a send abandoned on its final attempt (worker died mid-send). */
export const DELIVERY_ABANDONED = 'DELIVERY_ABANDONED'

/**
 * Provider text that says the provider will not send as this From:
 *
 * - `sender_not_authorized` (Frogmail's code; the Mailgun transport prefixes it);
 * - Resend: `550 The example.com domain is not verified. Please, add and verify your domain…`;
 * - Frogmail (Mailgun API): `The sender domain is not verified for this project.`,
 *   `The sender domain x is verified by another project…`,
 *   `Domain x is not verified for sending yet…`;
 * - Mailgun: `Domain not found`, `… is not allowed to send …`.
 *
 * The SMTP 553 code is matched separately (`isProviderSenderRejection`).
 */
const SENDER_REFUSAL_PATTERNS: RegExp[] = [
  /sender_not_authorized/i,
  /\bdomain is not verified\b/i,
  /\bnot verified for (?:sending|this project)\b/i,
  /\bsender domain\b.*\b(?:not verified|verified by another project|not allowed)\b/i,
  /^\s*domain not found\b/i,
  /\bnot allowed to send\b/i,
  /\bsender (?:address )?(?:rejected|refused|not authori[sz]ed)\b/i,
]

/** True when provider text says the From (domain) is refused. Does not look at SMTP codes. */
export function isSenderRefusalText(text: string): boolean {
  return SENDER_REFUSAL_PATTERNS.some((pattern) => pattern.test(text))
}

const CONFIGURATION_PATTERNS: RegExp[] = [
  /SUPPORT_SEND_TRANSPORT|SUPPORT_MAILGUN_|MAIL_FROM|needs a From address/i,
  /\b(?:invalid login|authentication (?:failed|required)|EAUTH|535)\b/i,
  /Mailgun API returned 40[13]\b/i,
  /\b(?:missing_scope|unauthenticated|forbidden)\b/i,
  /Outbound attachment/i,
]

const MAILBOX_FULL_PATTERNS: RegExp[] = [
  /\b(?:mailbox|inbox) (?:is )?full\b/i,
  /\bover ?quota\b|\bquota exceeded\b|\bexceeded (?:the )?(?:storage|quota)\b|insufficient (?:system )?storage/i,
  /\b[45]\.2\.2\b/,
  /(^|[^\w.])552(?=[\s-]|$)/,
]

const RECIPIENT_REJECTED_PATTERNS: RegExp[] = [
  /\b5\.1\.[0-36]\b/,
  /\b(?:user|mailbox|recipient|address) (?:unknown|not found|does not exist|unavailable|rejected)\b/i,
  /\bno such (?:user|mailbox|recipient)\b/i,
  /\brecipient address rejected\b|\binvalid recipient\b|\bdoes not exist\b/i,
  /\brecipient_suppressed\b|\bsuppress(?:ed|ion)\b/i,
  /(^|[^\w.])55[01](?=[\s-]|$)/,
]

const PROVIDER_UNAVAILABLE_PATTERNS: RegExp[] = [
  /\btime(?:d)? ?out\b|\bETIMEDOUT\b|did not answer in time/i,
  /\bE(?:CONNREFUSED|CONNRESET|NOTFOUND|AI_AGAIN|PIPE|SOCKET)\b|socket|could not be reached|request failed/i,
  /\b(?:service )?unavailable\b|\btry again later\b|\brate.?limit|\btoo many\b/i,
  /Mailgun API returned (?:429|5\d\d)\b/i,
  /(^|[^\w.])(?:421|45[0-2])(?=[\s-]|$)/,
]

/** Map a stored delivery error to a reason. Order matters: a sender refusal can also carry `550`. */
export function classifyDeliveryError(error: string | null | undefined): DeliveryFailureReason {
  const text = (error ?? '').trim()
  if (!text) return 'unknown'
  if (text === DELIVERY_ABANDONED) return 'abandoned'
  if (text === SENDER_DOMAIN_NOT_AUTHORIZED || isSenderRefusalText(text) || /(^|[^\w.])553(?=[\s-]|$)/.test(text)) {
    return 'sender_rejected'
  }
  if (CONFIGURATION_PATTERNS.some((pattern) => pattern.test(text))) return 'configuration'
  if (MAILBOX_FULL_PATTERNS.some((pattern) => pattern.test(text))) return 'mailbox_full'
  if (RECIPIENT_REJECTED_PATTERNS.some((pattern) => pattern.test(text))) return 'recipient_rejected'
  if (PROVIDER_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(text))) return 'provider_unavailable'
  return 'unknown'
}

export const DELIVERY_FAILURE_MESSAGES: Record<DeliveryFailureReason, string> = {
  sender_rejected: 'The mail provider refused the From address: its domain is not verified for sending.',
  recipient_rejected: 'The recipient’s mail server rejected the address. Check it for typos.',
  mailbox_full: 'The recipient’s mailbox is full.',
  provider_unavailable: 'The mail provider was unavailable or timed out.',
  configuration: 'Sending is not set up correctly on this server. Ask an administrator to check the mail settings.',
  abandoned: 'Sending was interrupted. The reply may or may not have gone out.',
  unknown: 'The reply could not be sent.',
}

export function describeDeliveryFailure(error: string | null | undefined): {
  reason: DeliveryFailureReason
  message: string
} {
  const reason = classifyDeliveryError(error)
  return { reason, message: DELIVERY_FAILURE_MESSAGES[reason] }
}
