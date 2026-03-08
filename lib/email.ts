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

interface EmailOptions {
  to: string
  subject: string
  html?: string
  text?: string
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

export async function sendEmail(options: EmailOptions) {
  // Check if we're on the server side
  if (import.meta.server) {
    // Directly use NodeMailer on server side
    const { sendMail } = useNodeMailer()

    try {
      const result = await sendMail({
        to: options.to,
        subject: options.subject,
        html: options.html || `<p>${options.text || 'Hello from Veerify!'}</p>`,
        text: options.text || 'Hello from Veerify!',
      })

      return {
        success: true,
        message: 'Email sent successfully',
        messageId: result.messageId,
      }
    } catch (error) {
      console.error('Email sending error:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send email',
        error: error,
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
