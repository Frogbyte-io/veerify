interface FeedbackConfirmationOptions {
  authorName: string
  feedbackTitle: string
  projectName: string
  editUrl: string
}

export function getFeedbackConfirmationTemplate({ authorName, feedbackTitle, projectName, editUrl }: FeedbackConfirmationOptions) {
  const subject = `Your feedback for ${projectName} has been received`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Feedback Received</h1>
      <p>Hi ${authorName},</p>
      <p>Thank you for submitting feedback to <strong>${projectName}</strong>. We've received your submission:</p>
      <div style="background: #f5f5f5; border-left: 4px solid #007bff; padding: 12px 16px; margin: 20px 0; border-radius: 0 4px 4px 0;">
        <p style="margin: 0; font-weight: bold; color: #333;">${feedbackTitle}</p>
      </div>
      <p>If you need to make changes to your submission, you can edit it using the link below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${editUrl}"
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Edit Your Feedback
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${editUrl}</p>
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

export function getEmailVerificationTemplate({ name, verificationUrl }: EmailVerificationOptions) {
  const subject = 'Verify your email address'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Welcome to Veerify!</h1>
      <p>Hi ${name},</p>
      <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" 
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Reset Your Password</h1>
      <p>Hi ${name},</p>
      <p>We received a request to reset your password for your Veerify account.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" 
           style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${resetUrl}</p>
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Sign in to Veerify</h1>
      <p>You requested a magic link to sign in to your Veerify account. Click the button below to continue:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${magicLinkUrl}"
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Sign In
        </a>
      </div>
      <p>If the button doesn't work, you can also copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #666;">${magicLinkUrl}</p>
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
