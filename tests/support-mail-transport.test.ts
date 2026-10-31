import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendEmailOptions } from '../lib/email'
import { resolveMailTransportConfig } from '../lib/mail-transport'
import { isProviderSenderRejection } from '../server/utils/outbound-delivery'
import {
  buildMailgunMessageForm,
  createSupportSendEmail,
  fitReferences,
  resetSharedSendKeyWarning,
  resolveSupportSendTransport,
  sendSupportEmailViaMailgun,
} from '../server/utils/support-mail-transport'

const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => log, logger: log }))
vi.mock('~/server/utils/sending-domains', () => ({ resolveEffectiveSenderPolicy: vi.fn() }))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => null) }))

const config = { apiKey: 'key-secret-123', apiBaseUrl: 'https://frogmail.example.test' }

/** A support reply as the outbox hands it to the transport. */
function reply(overrides: Partial<SendEmailOptions> = {}): SendEmailOptions {
  return {
    channel: 'support',
    to: ['customer@example.com', 'other@example.com'],
    cc: ['boss@example.com'],
    subject: 'Re: Invoice',
    html: '<p>Hi</p><img src="cid:logo.png">',
    text: 'Hi',
    from: { address: 'support@dotmatrixlabs.com', name: 'Dot "Matrix" Support' },
    replyTo: 'support@dotmatrixlabs.com',
    headers: {
      'Message-ID': '<veerify-1@dotmatrixlabs.com>',
      'In-Reply-To': '<customer-1@example.com>',
      References: '<root@example.com> <customer-1@example.com>',
      'X-Veerify-Idempotency-Key': 'idem-1',
      'X-Mailgun-Variables': JSON.stringify({ 'veerify-delivery-id': 'idem-1' }),
    },
    attachments: [
      { filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('pdf-bytes') },
      { filename: 'logo.png', contentType: 'image/png', content: Buffer.from('png-bytes'), cid: 'logo.png' },
    ],
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

describe('resolveSupportSendTransport', () => {
  it('defaults to SMTP, also for an empty value', () => {
    expect(resolveSupportSendTransport({})).toEqual({ transport: 'smtp' })
    expect(resolveSupportSendTransport({ SUPPORT_SEND_TRANSPORT: '  ' })).toEqual({ transport: 'smtp' })
    expect(resolveSupportSendTransport({ SUPPORT_SEND_TRANSPORT: 'SMTP' })).toEqual({ transport: 'smtp' })
  })

  it('prefers the send-only key and defaults the base URL to Mailgun', () => {
    expect(
      resolveSupportSendTransport({
        SUPPORT_SEND_TRANSPORT: 'mailgun',
        SUPPORT_MAILGUN_SEND_API_KEY: 'send-key',
        SUPPORT_MAILGUN_API_KEY: 'domains-key',
        SUPPORT_MAILGUN_API_BASE_URL: '',
      })
    ).toEqual({ transport: 'mailgun', apiKey: 'send-key', apiBaseUrl: 'https://api.mailgun.net', usesSharedKey: false })
  })

  it('falls back to SUPPORT_MAILGUN_API_KEY and strips a trailing slash from the base URL', () => {
    expect(
      resolveSupportSendTransport({
        SUPPORT_SEND_TRANSPORT: 'mailgun',
        SUPPORT_MAILGUN_API_KEY: 'domains-key',
        SUPPORT_MAILGUN_API_BASE_URL: 'https://frogmail.frogbyte.io/',
      })
    ).toEqual({
      transport: 'mailgun',
      apiKey: 'domains-key',
      apiBaseUrl: 'https://frogmail.frogbyte.io',
      usesSharedKey: true,
    })
  })

  it('reports a configuration error instead of falling back to SMTP', () => {
    expect(resolveSupportSendTransport({ SUPPORT_SEND_TRANSPORT: 'mailgun' })).toMatchObject({
      transport: 'misconfigured',
      error: expect.stringContaining('SUPPORT_MAILGUN_SEND_API_KEY'),
    })
    expect(
      resolveSupportSendTransport({
        SUPPORT_SEND_TRANSPORT: 'mailgun',
        SUPPORT_MAILGUN_SEND_API_KEY: 'k',
        SUPPORT_MAILGUN_API_BASE_URL: 'https://frogmail.example.test/v3',
      })
    ).toMatchObject({ transport: 'misconfigured', error: expect.stringContaining('SUPPORT_MAILGUN_API_BASE_URL') })
    expect(resolveSupportSendTransport({ SUPPORT_SEND_TRANSPORT: 'http' })).toMatchObject({
      transport: 'misconfigured',
    })
  })
})

describe('buildMailgunMessageForm', () => {
  it('maps addresses, bodies, Reply-To and custom headers onto Mailgun fields', async () => {
    const form = await buildMailgunMessageForm(reply(), '"Dot \\"Matrix\\" Support" <support@dotmatrixlabs.com>')

    expect(form.get('from')).toBe('"Dot \\"Matrix\\" Support" <support@dotmatrixlabs.com>')
    expect(form.getAll('to')).toEqual(['customer@example.com', 'other@example.com'])
    expect(form.getAll('cc')).toEqual(['boss@example.com'])
    expect(form.get('subject')).toBe('Re: Invoice')
    expect(form.get('text')).toBe('Hi')
    expect(form.get('html')).toBe('<p>Hi</p><img src="cid:logo.png">')
    expect(form.get('h:Reply-To')).toBe('support@dotmatrixlabs.com')
    expect(form.get('h:In-Reply-To')).toBe('<customer-1@example.com>')
    expect(form.get('h:References')).toBe('<root@example.com> <customer-1@example.com>')
    expect(form.get('h:X-Veerify-Idempotency-Key')).toBe('idem-1')
    // Frogmail turns this header into the user variables its delivery webhooks echo.
    expect(form.get('h:X-Mailgun-Variables')).toBe('{"veerify-delivery-id":"idem-1"}')
  })

  it('never sends Message-ID, which the provider assigns and refuses as an h: header', async () => {
    const form = await buildMailgunMessageForm(reply(), 'support@dotmatrixlabs.com')
    const names = [...form.keys()].map((name) => name.toLowerCase())
    expect(names).not.toContain('h:message-id')
  })

  it('sends attachments as `attachment` and cid parts as `inline` named by the cid', async () => {
    const form = await buildMailgunMessageForm(reply(), 'support@dotmatrixlabs.com')

    const [attachment] = form.getAll('attachment') as File[]
    expect(attachment.name).toBe('invoice.pdf')
    expect(attachment.type).toBe('application/pdf')
    expect(Buffer.from(await attachment.arrayBuffer()).toString()).toBe('pdf-bytes')

    const [inline] = form.getAll('inline') as File[]
    expect(inline.name).toBe('logo.png')
    expect(inline.type).toBe('image/png')
    expect(Buffer.from(await inline.arrayBuffer()).toString()).toBe('png-bytes')
  })

  it('accepts a single To and fills empty bodies like the SMTP payload', async () => {
    const form = await buildMailgunMessageForm(
      reply({ to: 'customer@example.com', cc: undefined, html: undefined, text: undefined, attachments: undefined }),
      'support@dotmatrixlabs.com'
    )
    expect(form.getAll('to')).toEqual(['customer@example.com'])
    expect(form.getAll('cc')).toEqual([])
    expect(form.get('text')).toBe('Hello from Veerify!')
    expect(form.get('html')).toBe('<p>Hello from Veerify!</p>')
  })
})

describe('fitReferences', () => {
  it('keeps a short chain unchanged', () => {
    expect(fitReferences('<a@x> <b@x>')).toBe('<a@x> <b@x>')
  })

  it('keeps the root and the most recent ids within the header limit', () => {
    const ids = Array.from(
      { length: 50 },
      (_, i) => `<message-${String(i).padStart(2, '0')}-${'x'.repeat(30)}@example.com>`
    )
    const fitted = fitReferences(ids.join(' '))
    expect(fitted.length).toBeLessThanOrEqual(998)
    const kept = fitted.split(' ')
    expect(kept[0]).toBe(ids[0])
    expect(kept.at(-1)).toBe(ids.at(-1))
    expect(ids.slice(-(kept.length - 1))).toEqual(kept.slice(1))
  })
})

describe('sendSupportEmailViaMailgun', () => {
  it('posts to /v3/{from domain}/messages with Basic auth and the idempotency key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { id: '<20261030120000.abc@dotmatrixlabs.com>', message: 'Queued. Thank you.' })
      )

    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })

    expect(result).toEqual({
      accepted: true,
      // Without angle brackets, like the SMTP reply's id and the delivery webhook's message-id.
      providerMessageId: '20261030120000.abc@dotmatrixlabs.com',
      response: '200 Queued. Thank you.',
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://frogmail.example.test/v3/dotmatrixlabs.com/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('api:key-secret-123').toString('base64')}`)
    expect(init.headers['Idempotency-Key']).toBe('idem-1')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('from')).toBe('"Dot \\"Matrix\\" Support" <support@dotmatrixlabs.com>')
  })

  it('falls back to the default From and its domain when the message has none', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: '<id@veerify.io>' }))

    await sendSupportEmailViaMailgun(reply({ from: undefined }), config, {
      fetchImpl,
      defaultFrom: 'Veerify <noreply@veerify.io>',
    })

    expect(fetchImpl.mock.calls[0][0]).toBe('https://frogmail.example.test/v3/veerify.io/messages')
    expect((fetchImpl.mock.calls[0][1].body as FormData).get('from')).toBe('Veerify <noreply@veerify.io>')
  })

  it.each([
    [404, { message: 'Domain not found: dotmatrixlabs.com' }],
    [
      400,
      {
        message: 'Domain dotmatrixlabs.com is not verified for sending yet. Finish DNS verification in Frogmail first.',
      },
    ],
    [400, { message: 'The sender domain is not verified for this project.' }],
    [422, { message: 'Sending from this address is refused.', code: 'sender_not_authorized' }],
    [403, { message: 'The acme.example domain is not verified. Please, add and verify your domain.' }],
  ])('reports a %i sender refusal so the outbox treats it as a sender rejection', async (status, body) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, body))

    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })

    expect(result.accepted).toBe(false)
    expect(result.response).toContain(body.message)
    expect(isProviderSenderRejection(result.response)).toBe(true)
  })

  it.each([
    [400, { message: 'to parameter is not a valid address. please check documentation' }, {}],
    [401, 'Forbidden', { 'X-Frogmail-Error': 'missing_scope' }],
    [404, '<html>Not Found</html>', {}],
    [429, { message: 'Too many requests' }, { 'Retry-After': '30' }],
    [500, { message: 'Server error' }, {}],
    [503, '', {}],
  ])('reports a %i as an ordinary, retryable failure', async (status, body, headers) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, body, headers))

    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })

    expect(result.accepted).toBe(false)
    expect(result.response).toContain(`Mailgun API returned ${status}`)
    expect(isProviderSenderRejection(result.response)).toBe(false)
  })

  it('names the Frogmail reason of a 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, 'Forbidden', { 'X-Frogmail-Error': 'missing_scope' }))
    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })
    expect(result.response).toBe('Mailgun API returned 401 (missing_scope): Forbidden')
  })

  it('reports network errors and timeouts as retryable failures without the API key', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED (key-secret-123)'))
    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })
    expect(result.accepted).toBe(false)
    expect(result.response).toContain('Mailgun API request failed: connect ECONNREFUSED')
    expect(result.response).not.toContain('key-secret-123')
    expect(isProviderSenderRejection(result.response)).toBe(false)

    const timeout = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    const timedOut = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl: timeout })
    expect(timedOut).toMatchObject({ accepted: false, response: expect.stringContaining('timeout') })
  })

  it('never echoes the API key from an error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { message: 'bad key key-secret-123' }))
    const result = await sendSupportEmailViaMailgun(reply(), config, { fetchImpl })
    expect(result.response).not.toContain('key-secret-123')
  })
})

describe('createSupportSendEmail', () => {
  beforeEach(() => resetSharedSendKeyWarning())

  it('sends over SMTP by default and never touches the network', async () => {
    const smtpSend = vi.fn().mockResolvedValue({ accepted: true, response: '250 ok' })
    const fetchImpl = vi.fn()

    const send = createSupportSendEmail(smtpSend, { env: {}, fetchImpl })
    await expect(send(reply())).resolves.toEqual({ accepted: true, response: '250 ok' })

    expect(smtpSend).toHaveBeenCalledWith(reply())
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends over the HTTP API when selected, without calling SMTP', async () => {
    const smtpSend = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: '<id@dotmatrixlabs.com>' }))

    const send = createSupportSendEmail(smtpSend, {
      env: {
        SUPPORT_SEND_TRANSPORT: 'mailgun',
        SUPPORT_MAILGUN_SEND_API_KEY: 'send-key',
        SUPPORT_MAILGUN_API_BASE_URL: 'https://frogmail.frogbyte.io',
      },
      fetchImpl,
    })
    await expect(send(reply())).resolves.toMatchObject({ accepted: true, providerMessageId: 'id@dotmatrixlabs.com' })

    expect(smtpSend).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://frogmail.frogbyte.io/v3/dotmatrixlabs.com/messages')
  })

  it('warns once when sending falls back to the shared domains key', async () => {
    log.warn.mockClear()
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, { id: '<id@dotmatrixlabs.com>' }))
    const send = createSupportSendEmail(vi.fn(), {
      env: { SUPPORT_SEND_TRANSPORT: 'mailgun', SUPPORT_MAILGUN_API_KEY: 'domains-key' },
      fetchImpl,
    })

    await send(reply())
    await send(reply())

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
      `Basic ${Buffer.from('api:domains-key').toString('base64')}`
    )
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toContain('SUPPORT_MAILGUN_SEND_API_KEY')
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('domains-key')
  })

  it('fails the delivery with the configuration error when no key is usable', async () => {
    const smtpSend = vi.fn()
    const fetchImpl = vi.fn()

    const send = createSupportSendEmail(smtpSend, { env: { SUPPORT_SEND_TRANSPORT: 'mailgun' }, fetchImpl })
    const result = await send(reply())

    expect(result.accepted).toBe(false)
    expect(result.response).toContain('SUPPORT_MAILGUN_SEND_API_KEY')
    expect(smtpSend).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('system mail', () => {
  it('keeps using SMTP whatever SUPPORT_SEND_TRANSPORT says', () => {
    const env = {
      SUPPORT_SEND_TRANSPORT: 'mailgun',
      SUPPORT_MAILGUN_SEND_API_KEY: 'send-key',
      SYSTEM_SMTP_HOST: 'smtp.resend.com',
    }
    expect(resolveMailTransportConfig('system', env)).toMatchObject({ host: 'smtp.resend.com' })
    expect(resolveMailTransportConfig('system', { SUPPORT_SEND_TRANSPORT: 'mailgun' })).toBeNull()
  })
})
