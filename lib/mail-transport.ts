/**
 * Which SMTP transport a message leaves through.
 *
 * Veerify has two kinds of outbound mail with different failure tolerances:
 *
 * - `support`: replies and auto-replies sent by the support outbox. Over SMTP,
 *   always the primary transport (`SMTP_*`, i.e. nuxt-nodemailer's runtime
 *   config), which is what a support provider such as Frogmail or Postmark is
 *   pointed at. With `SUPPORT_SEND_TRANSPORT=mailgun` the outbox skips SMTP
 *   and uses the provider's HTTP API instead (server/utils/support-mail-transport.ts).
 * - `system`: everything else - sign-in links, email verification, password
 *   reset, invitations, notifications and digests. Uses the optional
 *   `SYSTEM_SMTP_*` transport when `SYSTEM_SMTP_HOST` is set, and the primary
 *   transport otherwise, so nothing changes until an operator opts in.
 *
 * The split lets support mail move to a new provider while account recovery
 * stays on a separate, independently-failing one (e.g. Resend): an outage of
 * the support provider must not also lock users out of signing in.
 */

export type MailChannel = 'system' | 'support'

export interface SmtpTransportConfig {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
  /** Default From when a message does not carry one. */
  from?: string
}

type Env = Record<string, string | undefined>

/** Empty and whitespace-only values mean unset, as compose files emit `VAR=` for unused settings. */
function envValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

/**
 * The dedicated transport for `channel`, or null to use the primary
 * (nuxt-nodemailer) transport.
 *
 * Read at call time from the process environment rather than baked into the
 * Nuxt config at build time, so a prebuilt image can be switched with a
 * runtime variable change alone - which is also what makes rollback a revert
 * of environment values.
 */
export function resolveMailTransportConfig(
  channel: MailChannel,
  env: Env = process.env as Env
): SmtpTransportConfig | null {
  if (channel !== 'system') return null

  const host = envValue(env, 'SYSTEM_SMTP_HOST')
  if (!host) return null

  const secure = envValue(env, 'SYSTEM_SMTP_SECURE') === 'true'
  const parsedPort = Number(envValue(env, 'SYSTEM_SMTP_PORT'))
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : secure ? 465 : 587
  const user = envValue(env, 'SYSTEM_SMTP_USER')
  const pass = envValue(env, 'SYSTEM_SMTP_PASS')
  const from = envValue(env, 'SYSTEM_MAIL_FROM') ?? envValue(env, 'NUXT_NODEMAILER_FROM') ?? envValue(env, 'MAIL_FROM')

  return {
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
    ...(from ? { from } : {}),
  }
}

/**
 * The RFC 5322 Message-ID an SMTP submission gateway reports for the queued
 * message, angle brackets stripped, or null.
 *
 * Frogmail's gateway answers `250 2.0.0 Ok: queued as email_… <message-id>;
 * delivery is asynchronous`. Only an angle-bracketed id after `queued as` is
 * accepted: a bare queue id (Postfix's `queued as 4F2A1B`) is not a
 * Message-ID and must not be stored as one.
 */
export function parseSubmissionMessageId(response: string | null | undefined): string | null {
  if (typeof response !== 'string') return null
  const match = /queued as\s+\S+\s+<([^<>\s]+@[^<>\s]+)>/i.exec(response)
  return match ? match[1] : null
}
