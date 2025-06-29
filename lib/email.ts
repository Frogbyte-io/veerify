interface EmailOptions {
  to: string
  subject: string
  html?: string
  text?: string
}

export async function sendEmail(options: EmailOptions) {
  const { sendMail } = useNodeMailer()
  
  // Use the sendMail composable which automatically inherits the 'from' config
  const result = await sendMail({
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  })

  return result
} 