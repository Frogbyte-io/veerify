import {
  getCustomDomainConnectedTemplate,
  getCustomDomainVerifiedTemplate,
  getEmailVerificationTemplate,
  getFeedbackConfirmationTemplate,
  getMagicLinkTemplate,
  getOrganizationInvitationTemplate,
  getPasswordResetTemplate,
  getSubscriptionConfirmationTemplate,
  getStatusChangeNotificationTemplate,
  getNewCommentNotificationTemplate,
} from './email-templates'
import type { Readable } from 'node:stream'
import { createConsola } from 'consola'

const logger = createConsola().withTag('veerify').withTag('email')

/** An RFC-5322 mailbox. `name` is absent when the inbox has no `fromName`. */
export interface EmailAddress {
  address: string
  name?: string
}

/**
 * One attachment, already resolved to bytes.
 *
 * Deliberately NOT the storage-key shape the outbox row stores: resolving a
 * key is the delivery worker's job, and `lib/` must not reach into
 * `server/utils/storage`. The worker reads the key, then calls this.
 */
export interface EmailAttachment {
  filename: string
  content: Buffer | Readable
  contentType?: string
  /** Set for inline images so `cid:` references in the HTML resolve. */
  cid?: string
}

/**
 * Everything nodemailer needs to send one message. Every field beyond the
 * original four is optional, so the 10 existing call sites are unaffected.
 */
export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  cc?: string[]
  from?: EmailAddress
  replyTo?: string
  /** Message-ID, In-Reply-To and References are lifted out - see below. */
  headers?: Record<string, string>
  attachments?: EmailAttachment[]
}

export interface SendEmailResult {
  accepted: boolean
  providerMessageId?: string
  response: string
}

/** The object handed to nodemailer. */
export interface MailPayload {
  to: string | string[]
  subject: string
  html: string
  text: string
  cc?: string[]
  /**
   * nodemailer's `Address` requires `name`; an empty string renders as a bare
   * `From: support@acme.com`, verified against MailComposer.
   */
  from?: { name: string; address: string }
  replyTo?: string
  messageId?: string
  inReplyTo?: string
  references?: string
  headers?: Record<string, string>
  attachments?: EmailAttachment[]
}

/**
 * Threading headers lifted onto nodemailer's first-class options.
 *
 * This is normalization, not bug-avoidance. Verified against MailComposer:
 * nodemailer emits exactly ONE `Message-ID` whichever route you use, and when
 * both the option and a raw header are set the option silently wins. So the
 * point is to have a single canonical path rather than two that disagree
 * quietly, and to make the three values structural fields on `MailPayload` -
 * the delivery worker has to store the Message-ID on
 * `conversationMessage.channelMessageId` for Stage 03 to thread the reply
 * back, and reading that off a typed field beats grepping a header bag.
 *
 * Note nodemailer generates a Message-ID of its own when neither is supplied,
 * so an outgoing support reply must always set one explicitly - otherwise we
 * cannot know what to store.
 */
const THREADING_HEADER_OPTIONS: Record<string, 'messageId' | 'inReplyTo' | 'references'> = {
  'message-id': 'messageId',
  'in-reply-to': 'inReplyTo',
  references: 'references',
}

/**
 * Build the nodemailer payload from an options bag.
 *
 * Separate from `sendEmail` so it is unit-testable: `sendEmail` reaches for
 * `useNodeMailer()`, a Nuxt auto-import that does not exist under plain
 * vitest, which is why `lib/email.ts` had no tests before Stage 04.
 *
 * Optional keys are omitted rather than set to undefined. `from` in
 * particular: nuxt-nodemailer injects MAIL_FROM when the key is missing, and
 * an explicit undefined is not the same thing to every transport.
 */
export function buildMailPayload(options: SendEmailOptions): MailPayload {
  const payload: MailPayload = {
    to: options.to,
    subject: options.subject,
    html: options.html || `<p>${options.text || 'Hello from Veerify!'}</p>`,
    text: options.text || 'Hello from Veerify!',
  }

  if (options.from) payload.from = { name: options.from.name ?? '', address: options.from.address }
  if (options.replyTo) payload.replyTo = options.replyTo
  if (options.cc?.length) payload.cc = options.cc
  if (options.attachments?.length) payload.attachments = options.attachments

  if (options.headers) {
    const passthrough: Record<string, string> = {}

    for (const [name, value] of Object.entries(options.headers)) {
      // Case-insensitive: providers and our own code disagree on Message-ID
      // vs Message-Id, and a miss reintroduces the duplicate-header bug.
      const option = THREADING_HEADER_OPTIONS[name.trim().toLowerCase()]
      if (option) payload[option] = value
      else passthrough[name] = value
    }

    if (Object.keys(passthrough).length > 0) payload.headers = passthrough
  }

  return payload
}

interface EmailVerificationOptions {
  to: string
  name: string
  verificationUrl: string
}

interface MagicLinkEmailOptions {
  to: string
  magicLinkUrl: string
}

interface PasswordResetOptions {
  to: string
  name: string
  resetUrl: string
}

interface OrganizationInvitationEmailOptions {
  to: string
  organizationName: string
  inviterName: string
  inviteUrl: string
  role: string
  teamName?: string | null
}

interface FeedbackConfirmationEmailOptions {
  to: string
  authorName: string
  feedbackTitle: string
  projectName: string
  editUrl: string
}

interface CustomDomainEmailOptions {
  to: string
  name: string
  projectName: string
  domain: string
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult | Response> {
  // Check if we're on the server side
  if (import.meta.server) {
    // Directly use NodeMailer on server side
    const { sendMail } = useNodeMailer()

    try {
      const result = await sendMail(buildMailPayload(options))

      return {
        accepted: true,
        response: typeof result.response === 'string' ? result.response : 'Email accepted by transport',
      }
    } catch (error) {
      logger.error('Email sending failed', { error: error instanceof Error ? error.message : error })
      return {
        accepted: false,
        response: error instanceof Error ? error.message : 'Failed to send email',
      }
    }
  } else {
    // Use API endpoint on client side
    const result = await fetch('/api/mail/send-mail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    })
    return result
  }
}

export async function sendEmailVerificationEmail(options: EmailVerificationOptions) {
  const template = getEmailVerificationTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendMagicLinkEmail(options: MagicLinkEmailOptions) {
  const template = getMagicLinkTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendOrganizationInvitationEmail(options: OrganizationInvitationEmailOptions) {
  const template = getOrganizationInvitationTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendPasswordResetEmail(options: PasswordResetOptions) {
  const template = getPasswordResetTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendFeedbackConfirmationEmail(options: FeedbackConfirmationEmailOptions) {
  const template = getFeedbackConfirmationTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendCustomDomainConnectedEmail(options: CustomDomainEmailOptions) {
  const template = getCustomDomainConnectedTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

export async function sendCustomDomainVerifiedEmail(options: CustomDomainEmailOptions) {
  const template = getCustomDomainVerifiedTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  })
  return result
}

interface SubscriptionConfirmationEmailOptions {
  to: string
  feedbackTitle: string
  unsubscribeUrl: string
}

export async function sendFeedbackSubscriptionConfirmationEmail(options: SubscriptionConfirmationEmailOptions) {
  const template = getSubscriptionConfirmationTemplate(options)
  return sendEmail({ to: options.to, subject: template.subject, html: template.html, text: template.text })
}

interface StatusChangeNotificationEmailOptions {
  to: string
  feedbackTitle: string
  newStatus: string
  boardUrl: string
  unsubscribeUrl: string
}

export async function sendStatusChangeNotificationEmail(options: StatusChangeNotificationEmailOptions) {
  const template = getStatusChangeNotificationTemplate(options)
  return sendEmail({ to: options.to, subject: template.subject, html: template.html, text: template.text })
}

interface NewCommentNotificationEmailOptions {
  to: string
  feedbackTitle: string
  commenterName: string
  commentBody: string
  boardUrl: string
  unsubscribeUrl: string
}

export async function sendNewCommentNotificationEmail(options: NewCommentNotificationEmailOptions) {
  const template = getNewCommentNotificationTemplate(options)
  return sendEmail({ to: options.to, subject: template.subject, html: template.html, text: template.text })
}
