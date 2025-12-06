import { getEmailVerificationTemplate, getPasswordResetTemplate } from './email-templates'

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

interface PasswordResetOptions {
  to: string
  name: string
  resetUrl: string
}

export async function sendEmail(options: EmailOptions) {
  // Check if we're on the server side
  if (import.meta.server) {
    // Directly use NodeMailer on server side
    const { sendMail } = useNodeMailer()
    
    try {
      // Add timeout to prevent hanging (10 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Email sending timeout after 10 seconds')), 10000);
      });

      const sendPromise = sendMail({
        to: options.to,
        subject: options.subject,
        html: options.html || `<p>${options.text || 'Hello from Veerify!'}</p>`,
        text: options.text || 'Hello from Veerify!'
      });

      const result = await Promise.race([sendPromise, timeoutPromise]) as Awaited<ReturnType<typeof sendMail>>;
      
      return { 
        success: true, 
        message: 'Email sent successfully',
        messageId: result.messageId 
      }
    } catch (error) {
      console.error('Email sending error:', error)
      // Don't throw - let the caller handle it gracefully
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send email',
        error: error
      }
    }
  } else {
    // Use API endpoint on client side
    const result = await fetch('/api/mail/send-mail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
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
    text: template.text
  })
  return result 
}

export async function sendPasswordResetEmail(options: PasswordResetOptions) {
  const template = getPasswordResetTemplate(options)

  const result = await sendEmail({
    to: options.to,
    subject: template.subject,
    html: template.html,
    text: template.text
  })
  return result
}
