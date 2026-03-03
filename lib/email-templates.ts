/** Escape user-controlled strings before embedding them in HTML email bodies. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

interface FeedbackConfirmationOptions {
  authorName: string
  feedbackTitle: string
  projectName: string
  editUrl: string
}

export function getFeedbackConfirmationTemplate({
  authorName,
  feedbackTitle,
  projectName,
  editUrl,
}: FeedbackConfirmationOptions) {
  const subject = `Your feedback for ${projectName} has been received`

  const safeAuthorName = escapeHtml(authorName)
  const safeFeedbackTitle = escapeHtml(feedbackTitle)
  const safeProjectName = escapeHtml(projectName)
  const safeEditUrl = escapeHtml(editUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Feedback Received</h1>
      <p>Hi ${safeAuthorName},</p>
      <p>Thank you for submitting feedback to <strong>${safeProjectName}</strong>. We've received your submission:</p>
      <div style="background: #f5f5f5; border-left: 4px solid #007bff; padding: 12px 16px; margin: 20px 0; border-radius: 0 4px 4px 0;">
        <p style="margin: 0; font-weight: bold; color: #333;">${safeFeedbackTitle}</p>
      </div>
      <p>If you need to make changes to your submission, you can edit it using the link below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeEditUrl}"
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Edit Your Feedback
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${safeEditUrl}</p>
      <p>This edit link will expire in 7 days.</p>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        If you didn't submit this feedback, please ignore this email.
      </p>
    </div>
  `

  const text = `
Feedback Received

Hi ${authorName},

Thank you for submitting feedback to ${projectName}. We've received your submission:

"${feedbackTitle}"

If you need to make changes, edit your feedback at:
${editUrl}

This edit link will expire in 7 days.

If you didn't submit this feedback, please ignore this email.
  `

  return { subject, html, text }
}

interface MagicLinkOptions {
  magicLinkUrl: string
}

interface EmailVerificationOptions {
  name: string
  verificationUrl: string
}

interface PasswordResetOptions {
  name: string
  resetUrl: string
}

interface CustomDomainNotificationOptions {
  name: string
  projectName: string
  domain: string
}

export function getEmailVerificationTemplate({ name, verificationUrl }: EmailVerificationOptions) {
  const subject = 'Verify your email address'

  const safeName = escapeHtml(name)
  const safeVerificationUrl = escapeHtml(verificationUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Welcome to Veerify!</h1>
      <p>Hi ${safeName},</p>
      <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeVerificationUrl}"
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${safeVerificationUrl}</p>
      <p>This link will expire in 24 hours.</p>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        If you didn't create an account with Veerify, please ignore this email.
      </p>
    </div>
  `

  const text = `
Welcome to Veerify!

Hi ${name},

Thank you for signing up. Please verify your email address by visiting this link:
${verificationUrl}

This link will expire in 24 hours.

If you didn't create an account with Veerify, please ignore this email.
  `

  return { subject, html, text }
}

export function getPasswordResetTemplate({ name, resetUrl }: PasswordResetOptions) {
  const subject = 'Reset your password'

  const safeName = escapeHtml(name)
  const safeResetUrl = escapeHtml(resetUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Reset Your Password</h1>
      <p>Hi ${safeName},</p>
      <p>We received a request to reset your password for your Veerify account.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeResetUrl}"
           style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${safeResetUrl}</p>
      <p>This link will expire in 1 hour.</p>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        If you didn't request a password reset, please ignore this email.
      </p>
    </div>
  `

  const text = `
Reset Your Password

Hi ${name},

We received a request to reset your password for your Veerify account.

Please reset your password by visiting this link:
${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, please ignore this email.
  `

  return { subject, html, text }
}

export function getMagicLinkTemplate({ magicLinkUrl }: MagicLinkOptions) {
  const subject = 'Your sign-in link for Veerify'

  const safeMagicLinkUrl = escapeHtml(magicLinkUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Sign in to Veerify</h1>
      <p>You requested a magic link to sign in to your Veerify account. Click the button below to continue:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeMagicLinkUrl}"
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Sign In
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${safeMagicLinkUrl}</p>
      <p>This link will expire in 5 minutes.</p>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">
        If you didn't request this link, please ignore this email.
      </p>
    </div>
  `

  const text = `
Sign in to Veerify

You requested a magic link to sign in to your Veerify account.

Sign in by visiting this link:
${magicLinkUrl}

This link will expire in 5 minutes.

If you didn't request this link, please ignore this email.
  `

  return { subject, html, text }
}

export function getCustomDomainConnectedTemplate({ name, projectName, domain }: CustomDomainNotificationOptions) {
  const subject = `Custom domain connected for ${projectName}`

  const safeName = escapeHtml(name)
  const safeProjectName = escapeHtml(projectName)
  const safeDomain = escapeHtml(domain)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Custom domain connected</h1>
      <p>Hi ${safeName},</p>
      <p>Your custom domain has been connected to <strong>${safeProjectName}</strong>.</p>
      <p>
        Domain:
        <span style="font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px;">${safeDomain}</span>
      </p>
      <p>Next step: verify DNS to confirm the CNAME is resolving correctly.</p>
    </div>
  `

  const text = `
Custom domain connected

Hi ${name},

Your custom domain has been connected to ${projectName}.
Domain: ${domain}

Next step: verify DNS to confirm the CNAME is resolving correctly.
  `

  return { subject, html, text }
}

export function getCustomDomainVerifiedTemplate({ name, projectName, domain }: CustomDomainNotificationOptions) {
  const subject = `Custom domain verified for ${projectName}`

  const safeName = escapeHtml(name)
  const safeProjectName = escapeHtml(projectName)
  const safeDomain = escapeHtml(domain)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Custom domain verified</h1>
      <p>Hi ${safeName},</p>
      <p>Your DNS check passed and your custom domain is now verified for <strong>${safeProjectName}</strong>.</p>
      <p>
        Domain:
        <span style="font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px;">${safeDomain}</span>
      </p>
      <p>Visitors can now reliably access your public board using this domain.</p>
    </div>
  `

  const text = `
Custom domain verified

Hi ${name},

Your DNS check passed and your custom domain is now verified for ${projectName}.
Domain: ${domain}

Visitors can now reliably access your public board using this domain.
  `

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Feedback subscription emails
// ---------------------------------------------------------------------------

interface SubscriptionConfirmationOptions {
  feedbackTitle: string
  unsubscribeUrl: string
}

export function getSubscriptionConfirmationTemplate({ feedbackTitle, unsubscribeUrl }: SubscriptionConfirmationOptions) {
  const subject = `You're subscribed to updates for "${feedbackTitle}"`
  const safeTitle = escapeHtml(feedbackTitle)
  const safeUnsubUrl = escapeHtml(unsubscribeUrl)

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a">Subscribed to feedback updates</h2>
      <p style="color:#444">You'll receive an email whenever the status changes or a new public comment is posted on:</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
        <strong style="color:#1a1a1a">${safeTitle}</strong>
      </div>
      <p style="color:#444">To unsubscribe at any time, click the link below:</p>
      <p><a href="${safeUnsubUrl}" style="color:#6366f1">Unsubscribe from this feedback</a></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:12px">Powered by Veerify</p>
    </div>
  `

  const text = `You're subscribed to updates for "${feedbackTitle}".

You'll receive an email whenever the status changes or a new public comment is posted.

To unsubscribe: ${unsubscribeUrl}
`

  return { subject, html, text }
}

interface StatusChangeNotificationOptions {
  feedbackTitle: string
  newStatus: string
  boardUrl: string
  unsubscribeUrl: string
}

export function getStatusChangeNotificationTemplate({
  feedbackTitle,
  newStatus,
  boardUrl,
  unsubscribeUrl,
}: StatusChangeNotificationOptions) {
  const subject = `Status update: "${feedbackTitle}" is now ${newStatus}`
  const safeTitle = escapeHtml(feedbackTitle)
  const safeStatus = escapeHtml(newStatus)
  const safeBoardUrl = escapeHtml(boardUrl)
  const safeUnsubUrl = escapeHtml(unsubscribeUrl)

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a">Feedback status updated</h2>
      <p style="color:#444">The status of the following feedback item has changed:</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
        <strong style="color:#1a1a1a">${safeTitle}</strong><br/>
        <span style="color:#6366f1;font-weight:600">New status: ${safeStatus}</span>
      </div>
      <p><a href="${safeBoardUrl}" style="color:#6366f1">View on the feedback board</a></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:12px">
        <a href="${safeUnsubUrl}" style="color:#999">Unsubscribe from this feedback</a> &middot; Powered by Veerify
      </p>
    </div>
  `

  const text = `Feedback status updated: "${feedbackTitle}" is now ${newStatus}.

View on the board: ${boardUrl}

To unsubscribe: ${unsubscribeUrl}
`

  return { subject, html, text }
}

interface NewCommentNotificationOptions {
  feedbackTitle: string
  commenterName: string
  commentBody: string
  boardUrl: string
  unsubscribeUrl: string
}

export function getNewCommentNotificationTemplate({
  feedbackTitle,
  commenterName,
  commentBody,
  boardUrl,
  unsubscribeUrl,
}: NewCommentNotificationOptions) {
  const subject = `New comment on "${feedbackTitle}"`
  const safeTitle = escapeHtml(feedbackTitle)
  const safeName = escapeHtml(commenterName)
  const safeComment = escapeHtml(commentBody.length > 300 ? commentBody.slice(0, 300) + '…' : commentBody)
  const safeBoardUrl = escapeHtml(boardUrl)
  const safeUnsubUrl = escapeHtml(unsubscribeUrl)

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a">New comment on your subscribed feedback</h2>
      <p style="color:#444"><strong>${safeName}</strong> commented on <strong>${safeTitle}</strong>:</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0;color:#444;white-space:pre-line">${safeComment}</div>
      <p><a href="${safeBoardUrl}" style="color:#6366f1">View full discussion</a></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#999;font-size:12px">
        <a href="${safeUnsubUrl}" style="color:#999">Unsubscribe from this feedback</a> &middot; Powered by Veerify
      </p>
    </div>
  `

  const text = `${commenterName} commented on "${feedbackTitle}":

${commentBody.length > 300 ? commentBody.slice(0, 300) + '…' : commentBody}

View full discussion: ${boardUrl}

To unsubscribe: ${unsubscribeUrl}
`

  return { subject, html, text }
}
