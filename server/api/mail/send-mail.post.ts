export default defineEventHandler(async (event) => {
  let body = await readBody(event)
  const { sendMail } = useNodeMailer()

  //turn body into json if it's not already
  body = typeof body === 'string' ? JSON.parse(body) : body

  // Validate required fields
  if (!body.to || !body.subject) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: to, subject'
    })
  }

  try {
    // Send email - 'from' is automatically inherited from nuxt.config.ts
    const result = await sendMail({
      to: body.to,
      subject: body.subject,
      html: body.html || `<p>${body.text || 'Hello from Veerify!'}</p>`,
      text: body.text || 'Hello from Veerify!'
    })

    return { 
      success: true, 
      message: 'Email sent successfully',
      messageId: result.messageId 
    }
  } catch (error) {
    console.error('Email sending error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to send email',
      data: { error: errorMessage }
    })
  }
}) 