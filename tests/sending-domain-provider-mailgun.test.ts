import { describe, expect, it, vi } from 'vitest'

import { MailgunSendingDomainProvider, escapeRouteAddress } from '../server/services/sending-domains/providers/mailgun'
import type { FetchImpl } from '../server/services/support-channels/types'
import { SendingDomainProviderError } from '../server/services/sending-domains/types'

const KEY = 'key-super-secret'
const basic = `Basic ${Buffer.from(`api:${KEY}`).toString('base64')}`

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const detail = {
  message: 'Domain DNS records have been created',
  domain: { name: 'acme.com', state: 'unverified' },
  sending_dns_records: [
    { name: 'k1._domainkey.acme.com', record_type: 'CNAME', value: 'k1.dkim.example', valid: 'unknown' },
    { name: 'mail.acme.com', record_type: 'MX', value: 'feedback-smtp.example', priority: '10', valid: 'valid' },
  ],
  receiving_dns_records: [{ record_type: 'MX', value: 'route1.mx.example', priority: '5', valid: 'invalid' }],
}

function make(fetchImpl: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return new MailgunSendingDomainProvider({
    apiKey: KEY,
    accountKey: 'acct',
    apiBaseUrl: 'https://frogmail.test/',
    fetchImpl: fetchImpl as unknown as FetchImpl,
    ...extra,
  })
}

async function failure(promise: Promise<unknown>): Promise<SendingDomainProviderError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SendingDomainProviderError)
    return error as SendingDomainProviderError
  }
  throw new Error('expected rejection')
}

describe('configuration', () => {
  it('reports missing settings by name only', () => {
    expect(new MailgunSendingDomainProvider({ apiKey: '', accountKey: '' }).isConfigured()).toEqual({
      configured: false,
      missing: ['SUPPORT_MAILGUN_API_KEY', 'SUPPORT_MAILGUN_ACCOUNT_KEY'],
    })
    expect(make(vi.fn()).isConfigured()).toEqual({ configured: true, missing: [] })
  })

  it('falls back to the default base URL when the env value is empty', async () => {
    vi.stubEnv('SUPPORT_MAILGUN_API_BASE_URL', '')
    try {
      const fetchImpl = vi.fn(async () => json(detail))
      await new MailgunSendingDomainProvider({ apiKey: KEY, fetchImpl: fetchImpl as unknown as FetchImpl }).get(
        'acme.com'
      )
      expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.mailgun.net/v4/domains/acme.com')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('has full capabilities including subdomain authorization', () => {
    expect(make(vi.fn()).capabilities).toEqual({
      register: true,
      verifyNow: true,
      remove: true,
      inboundRoutes: true,
      authorizesSubdomains: true,
    })
  })
})

describe('register', () => {
  it('posts the name as a form with Basic auth and maps records', async () => {
    const fetchImpl = vi.fn(async () => json(detail))
    const result = await make(fetchImpl).register(' ACME.com. ')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v4/domains')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(basic)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(init.body).toBe('name=acme.com')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    expect(result).toEqual({
      domain: 'acme.com',
      state: 'unverified',
      receivesMail: true,
      ownership: 'created',
      message: 'Domain DNS records have been created',
      records: [
        {
          purpose: 'sending',
          type: 'CNAME',
          name: 'k1._domainkey.acme.com',
          value: 'k1.dkim.example',
          status: 'unknown',
        },
        {
          purpose: 'sending',
          type: 'MX',
          name: 'mail.acme.com',
          value: 'feedback-smtp.example',
          priority: '10',
          status: 'valid',
        },
        {
          purpose: 'receiving',
          type: 'MX',
          name: 'acme.com',
          value: 'route1.mx.example',
          priority: '5',
          status: 'invalid',
        },
      ],
    })
  })

  it('reports receivesMail false and active state when there are no receiving records', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ domain: { name: 'acme.com', state: 'active' }, sending_dns_records: [], receiving_dns_records: [] })
    )
    const result = await make(fetchImpl).register('acme.com')
    expect(result.state).toBe('active')
    expect(result.receivesMail).toBe(false)
    expect(result.message).toBeNull()
  })

  it('adopts the domain through GET when the project already has it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'This domain name is already taken' }, 400))
      .mockResolvedValueOnce(json({ ...detail, domain: { name: 'acme.com', state: 'active' } }))
    const result = await make(fetchImpl).register('acme.com')

    expect(result.ownership).toBe('adopted')
    expect(result.state).toBe('active')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://frogmail.test/v4/domains/acme.com')
  })

  it('fails with already_exists when the adopt lookup finds nothing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'This domain name is already taken' }, 400))
      .mockResolvedValueOnce(json({ message: 'Domain not found' }, 404))
    expect((await failure(make(fetchImpl).register('acme.com'))).code).toBe('already_exists')
  })

  it('adopts on the machine-readable domain_taken code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'x' }, 400, { 'X-Frogmail-Error': 'domain_taken' }))
      .mockResolvedValueOnce(json(detail))
    expect((await make(fetchImpl).register('acme.com')).ownership).toBe('adopted')
  })
})

describe('get, verify and remove', () => {
  it('get returns null on 404', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Domain not found' }, 404))
    expect(await make(fetchImpl).get('acme.com')).toBeNull()
  })

  it('get issues GET /v4/domains/{domain}', async () => {
    const fetchImpl = vi.fn(async () => json(detail))
    await make(fetchImpl).get('acme.com')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v4/domains/acme.com')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('reports a domain another project owns as unverified with a clear message', async () => {
    const contested = {
      ...detail,
      message: 'Domain DNS records have been updated',
      domain: { name: 'acme.com', state: 'unverified', frogmail_sending_owner: 'other_project' },
    }
    const result = await make(vi.fn(async () => json(contested))).get('acme.com')
    expect(result).toMatchObject({
      state: 'unverified',
      contested: true,
      message: 'Another service already sends from this domain.',
    })
  })

  it('never trusts an active state next to frogmail_sending_owner', async () => {
    const body = { domain: { name: 'acme.com', state: 'active', frogmail_sending_owner: 'other_project' } }
    const verified = await make(vi.fn(async () => json(body))).verify('acme.com')
    expect(verified.state).toBe('unverified')
    expect(verified.contested).toBe(true)
  })

  it('leaves uncontested results without the contested flag', async () => {
    const result = await make(vi.fn(async () => json(detail))).get('acme.com')
    expect(result).not.toHaveProperty('contested')
    expect(result?.message).toBe('Domain DNS records have been created')
  })

  it('verify issues PUT .../verify', async () => {
    const fetchImpl = vi.fn(async () => json({ ...detail, domain: { name: 'acme.com', state: 'active' } }))
    const result = await make(fetchImpl).verify('acme.com')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v4/domains/acme.com/verify')
    expect(init.method).toBe('PUT')
    expect(result.state).toBe('active')
  })

  it('verify surfaces not_found', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Domain not found' }, 404))
    expect((await failure(make(fetchImpl).verify('acme.com'))).code).toBe('not_found')
  })

  it('remove issues DELETE /v3/domains and merges restored into removed', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        message: 'Domain has been deleted',
        frogmail_dns_cleanup: { removed: ['a'], restored: ['spf'], kept: ['mx'], failed: ['x'] },
      })
    )
    const result = await make(fetchImpl).remove('acme.com')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v3/domains/acme.com')
    expect(init.method).toBe('DELETE')
    expect(result).toEqual({ cleanup: { removed: ['a', 'spf'], kept: ['mx'], failed: ['x'] } })
  })

  it('remove returns null cleanup when the response has no report', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Domain has been deleted' }))
    expect(await make(fetchImpl).remove('acme.com')).toEqual({ cleanup: null })
  })

  it('remove refuses a domain that receives mail', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ message: 'acme.com receives mail through Frogmail. Delete it in the dashboard.' }, 400)
    )
    expect((await failure(make(fetchImpl).remove('acme.com'))).code).toBe('receiving_enabled')
  })
})

describe('error mapping', () => {
  const cases: [string, number, string, Record<string, string>, string, boolean][] = [
    [
      'another project',
      400,
      'acme.com is already a verified sending domain of another project',
      {},
      'owned_elsewhere',
      false,
    ],
    ['already taken', 400, 'This domain name is already taken', {}, 'already_exists', false],
    ['receives mail', 400, 'acme.com receives mail through Frogmail', {}, 'receiving_enabled', false],
    ['other 400', 400, "'name' parameter is not a valid domain name", {}, 'invalid_domain', false],
    ['401 default', 401, 'Forbidden', {}, 'unauthorized', false],
    ['401 unauthenticated', 401, 'Forbidden', { 'X-Frogmail-Error': 'unauthenticated' }, 'unauthorized', false],
    ['401 missing scope', 401, 'Forbidden', { 'X-Frogmail-Error': 'missing_scope' }, 'missing_scope', false],
    ['404', 404, 'Domain not found', {}, 'not_found', false],
    ['500', 500, 'boom', {}, 'provider_unavailable', true],
    ['502', 502, 'The sending provider could not register acme.com', {}, 'provider_unavailable', true],
    ['header owned elsewhere', 400, 'x', { 'X-Frogmail-Error': 'domain_owned_elsewhere' }, 'owned_elsewhere', false],
    ['header invalid', 400, 'another project', { 'X-Frogmail-Error': 'invalid_domain' }, 'invalid_domain', false],
    ['header receives', 400, 'x', { 'X-Frogmail-Error': 'domain_receives_mail' }, 'receiving_enabled', false],
    ['header unavailable', 400, 'x', { 'X-Frogmail-Error': 'provider_unavailable' }, 'provider_unavailable', true],
    ['unexpected 418', 418, 'teapot', {}, 'unknown', false],
  ]

  it.each(cases)('%s', async (_label, status, message, headers, code, retryable) => {
    const fetchImpl = vi.fn(async () => json({ message }, status, headers))
    const error = await failure(make(fetchImpl).verify('acme.com'))
    expect(error.code).toBe(code)
    expect(error.retryable).toBe(retryable)
  })

  it('maps 429 with Retry-After seconds', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'slow down' }, 429, { 'Retry-After': '37' }))
    const error = await failure(make(fetchImpl).verify('acme.com'))
    expect(error).toMatchObject({ code: 'rate_limited', retryable: true, retryAfterSeconds: 37 })
  })

  it('maps 429 without Retry-After', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'slow down' }, 429))
    expect((await failure(make(fetchImpl).verify('acme.com'))).retryAfterSeconds).toBeUndefined()
  })

  it('maps network errors to a retryable provider_unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await failure(make(fetchImpl).verify('acme.com'))
    expect(error).toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  it('maps a timeout to a retryable provider_unavailable', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    })
    const error = await failure(make(fetchImpl, { timeoutMs: 20 }).verify('acme.com'))
    expect(error).toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  it('treats an unreadable success body as unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect((await failure(make(fetchImpl).verify('acme.com'))).code).toBe('provider_unavailable')
  })

  it('sanitizes messages and never leaks the API key', async () => {
    const noisy = `bad   thing\n happened ${KEY} ${'x'.repeat(800)}`
    const fetchImpl = vi.fn(async () => json({ message: noisy }, 400))
    const error = await failure(make(fetchImpl).verify('acme.com'))
    expect(error.message).not.toContain(KEY)
    expect(error.message).toContain('bad thing happened [redacted]')
    expect(error.message.length).toBeLessThanOrEqual(500)
  })
})

describe('inbound routes', () => {
  it('escapes the address and posts the route as a form', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Route has been created', route: { id: 'route-1' } }))
    const result = await make(fetchImpl).createInboundRoute({
      address: 'Help-Desk_1.team@acme.com',
      forwardUrl: 'https://veerify.test/api/support/inbound/mailgun',
      description: 'veerify:inbox1:addr1',
    })

    expect(result).toEqual({ routeId: 'route-1' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v3/routes')
    expect(init.method).toBe('POST')
    const form = new URLSearchParams(init.body as string)
    expect(form.get('expression')).toBe('match_recipient("^help\\-desk\\_1\\.team@acme\\.com$")')
    expect(form.getAll('action')).toEqual(['forward("https://veerify.test/api/support/inbound/mailgun")', 'stop()'])
    expect(form.get('priority')).toBe('10')
    expect(form.get('description')).toBe('veerify:inbox1:addr1')
  })

  it('refuses plus addresses before calling the provider', async () => {
    const fetchImpl = vi.fn()
    const error = await failure(
      make(fetchImpl).createInboundRoute({ address: 'a+b@acme.com', forwardUrl: 'https://x.test', description: 'd' })
    )
    expect(error.code).toBe('invalid_domain')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('escapeRouteAddress rejects unsupported characters', () => {
    expect(() => escapeRouteAddress('a+b@acme.com')).toThrow(SendingDomainProviderError)
    expect(() => escapeRouteAddress('a(b)@acme.com')).toThrow(SendingDomainProviderError)
    expect(escapeRouteAddress('support@acme.com')).toBe('support@acme\\.com')
  })

  it('deletes a route and treats a missing route as success', async () => {
    const ok = vi.fn(async () => json({ id: 'route-1', message: 'Route has been deleted' }))
    await make(ok).deleteInboundRoute('route-1')
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://frogmail.test/v3/routes/route-1')
    expect(init.method).toBe('DELETE')

    const gone = vi.fn(async () => json({ message: 'Route not found' }, 404))
    await expect(make(gone).deleteInboundRoute('route-1')).resolves.toBeUndefined()

    const down = vi.fn(async () => json({ message: 'x' }, 503))
    expect((await failure(make(down).deleteInboundRoute('route-1'))).code).toBe('provider_unavailable')
  })

  it('fails when the provider returns no route id', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Route has been created' }))
    const error = await failure(
      make(fetchImpl).createInboundRoute({ address: 'a@acme.com', forwardUrl: 'https://x.test', description: 'd' })
    )
    expect(error.code).toBe('unknown')
  })
})
