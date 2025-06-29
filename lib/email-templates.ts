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