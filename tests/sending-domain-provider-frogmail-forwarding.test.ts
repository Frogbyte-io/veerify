import { describe, expect, it, vi } from 'vitest'

import { MAX_ROUTE_FORWARDS, MailgunSendingDomainProvider } from '../server/services/sending-domains/providers/mailgun'
import type { FetchImpl } from '../server/services/support-channels/types'
import { SendingDomainProviderError } from '../server/services/sending-domains/types'

// Response shapes pinned by Frogmail tests/Fixtures/Contract/veerify/*.json.
const receiving = {
  data: {
    domain: 'mail.example.com',
    provider: 'ses',
    status: 'active',
    records: [
      {
        type: 'MX',
        name: 'mail.example.com',
        priority: 10,
        value: 'inbound-smtp.us-east-1.amazonaws.com',
        status: 'valid',
      },
    ],
    checks: [],
    forwarding_paused: false,
    last_received_at: null,
  },
}
const destination = {
  id: 'fwd_1',
  object: 'forward_destination',
  domain: 'mail.example.com',
  email: 'owner@example.org',
  status: 'pending',
  status_reason: null,
  verified_at: null,
  verification_sent_at: '2026-10-30T10:00:00Z',
}
const routeResponse = {
  message: 'Route has been created',
  route: { id: 'route_1', priority: 10 },
  frogmail_forward_destinations: [
    { id: 'fwd_1', email: 'owner@example.org', status: 'pending', verification_sent_at: '2026-10-30T10:00:00Z' },
  ],
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function make(fetchImpl: ReturnType<typeof vi.fn>) {
  return new MailgunSendingDomainProvider({
    apiKey: 'key-secret',
    accountKey: 'acct',
    apiBaseUrl: 'https://frogmail.test/',
    fetchImpl: fetchImpl as unknown as FetchImpl,
  })
}

function call(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchImpl.mock.calls[index] as [string, RequestInit]
  return { url, method: init.method, headers: init.headers as Record<string, string>, body: init.body }
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

describe('receiving', () => {
  it('enables SES receiving with Bearer auth and maps the MX record', async () => {
    const fetchImpl = vi.fn(async () => json(receiving))
    const state = await make(fetchImpl).enableReceiving('Mail.Example.com')
    const sent = call(fetchImpl)
    expect(sent.url).toBe('https://frogmail.test/api/v1/domains/mail.example.com/receiving')
    expect(sent.method).toBe('PUT')
    expect(JSON.parse(String(sent.body))).toEqual({ provider: 'ses' })
    expect(JSON.stringify(sent.headers)).toContain('Bearer key-secret')
    expect(state).toMatchObject({ status: 'active', forwardingPaused: false, lastReceivedAt: null })
    expect(state.records[0]).toMatchObject({
      purpose: 'receiving',
      type: 'MX',
      value: 'inbound-smtp.us-east-1.amazonaws.com',
      priority: '10',
    })
  })

  it('returns null when the domain is unknown and pauses forwarding', async () => {
    const missing = vi.fn(async () => json({ error: 'not found' }, 404, { 'X-Frogmail-Error': 'not_found' }))
    expect(await make(missing).getReceiving('mail.example.com')).toBeNull()

    const paused = vi.fn(async () => json({ data: { ...receiving.data, forwarding_paused: true } }))
    const state = await make(paused).setForwardingPaused('mail.example.com', true)
    expect(call(paused).method).toBe('PATCH')
    expect(JSON.parse(String(call(paused).body))).toEqual({ forwarding_paused: true })
    expect(state.forwardingPaused).toBe(true)
  })

  it('maps the receiving error codes', async () => {
    for (const code of ['receiving_provider_conflict', 'domain_receives_elsewhere', 'domain_not_receiving'] as const) {
      const fetchImpl = vi.fn(async () => json({ error: 'x' }, 409, { 'X-Frogmail-Error': code }))
      expect((await failure(make(fetchImpl).enableReceiving('mail.example.com'))).code).toBe(code)
    }
  })
})

describe('forward destinations', () => {
  it('lists, creates, resends and revokes', async () => {
    const list = vi.fn(async () => json({ data: [destination] }))
    expect(await make(list).listForwardDestinations('mail.example.com')).toEqual([
      expect.objectContaining({ id: 'fwd_1', email: 'owner@example.org', status: 'pending', statusReason: null }),
    ])
    expect(call(list).url).toBe('https://frogmail.test/api/v1/forward-destinations?domain=mail.example.com')

    const create = vi.fn(async () => json({ data: destination }, 201))
    const created = await make(create).createForwardDestination('mail.example.com', 'Owner@Example.org')
    expect(JSON.parse(String(call(create).body))).toEqual({ domain: 'mail.example.com', email: 'owner@example.org' })
    expect(created.verificationSentAt).toEqual(new Date('2026-10-30T10:00:00Z'))

    const resend = vi.fn(async () => json({ data: destination }))
    await make(resend).resendForwardDestination('fwd_1')
    expect(call(resend)).toMatchObject({
      url: 'https://frogmail.test/api/v1/forward-destinations/fwd_1/resend',
      method: 'POST',
    })

    const revoke = vi.fn(async () => json({ data: { ...destination, status: 'revoked', status_reason: 'api' } }))
    expect(await make(revoke).deleteForwardDestination('fwd_1')).toMatchObject({
      status: 'revoked',
      statusReason: 'api',
    })
    const gone = vi.fn(async () => json({ error: 'x' }, 404, { 'X-Frogmail-Error': 'not_found' }))
    expect(await make(gone).deleteForwardDestination('fwd_1')).toBeNull()
  })

  it('maps conflict and throttling', async () => {
    const conflict = vi.fn(async () => json({ error: 'x' }, 409, { 'X-Frogmail-Error': 'conflict' }))
    expect((await failure(make(conflict).resendForwardDestination('fwd_1'))).code).toBe('conflict')
    const throttled = vi.fn(async () => json({ error: 'x' }, 429, { 'Retry-After': '120' }))
    const error = await failure(make(throttled).resendForwardDestination('fwd_1'))
    expect(error.retryAfterSeconds).toBe(120)
  })
})

describe('inbound routes with forwards', () => {
  const actions = (fetchImpl: ReturnType<typeof vi.fn>) =>
    new URLSearchParams(String(call(fetchImpl).body)).getAll('action')

  it('builds inbox, then forwards, then stop, and returns the destinations', async () => {
    const fetchImpl = vi.fn(async () => json(routeResponse))
    const result = await make(fetchImpl).createInboundRoute({
      address: 'support@mail.example.com',
      forwardUrl: 'https://veerify.example/api/support/inbound/mailgun',
      forwardTo: ['owner@example.org', 'Owner@example.org', 'ops@example.org'],
      description: 'veerify:i:a',
    })
    expect(actions(fetchImpl)).toEqual([
      'forward("https://veerify.example/api/support/inbound/mailgun")',
      'forward("owner@example.org")',
      'forward("ops@example.org")',
      'stop()',
    ])
    expect(result.routeId).toBe('route_1')
    expect(result.forwardDestinations).toEqual([
      expect.objectContaining({ id: 'fwd_1', email: 'owner@example.org', status: 'pending' }),
    ])
  })

  it('builds a forward-only route without the inbox action', async () => {
    const fetchImpl = vi.fn(async () => json(routeResponse))
    await make(fetchImpl).updateInboundRoute('route_1', {
      address: 'support@mail.example.com',
      forwardUrl: null,
      forwardTo: ['owner@example.org'],
      description: 'd',
    })
    expect(call(fetchImpl).method).toBe('PUT')
    expect(actions(fetchImpl)).toEqual(['forward("owner@example.org")', 'stop()'])
  })

  it('allows five forwards, refuses six, and refuses a route with no action', async () => {
    const emails = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@example.org`)
    expect(MAX_ROUTE_FORWARDS).toBe(5)
    const fetchImpl = vi.fn(async () => json(routeResponse))
    const provider = make(fetchImpl)
    const base = { address: 'a@mail.example.com', forwardUrl: null, description: 'd' }
    await provider.createInboundRoute({ ...base, forwardTo: emails(5) })
    expect((await failure(provider.createInboundRoute({ ...base, forwardTo: emails(6) }))).code).toBe(
      'forward_destination_invalid'
    )
    await failure(provider.createInboundRoute({ ...base, forwardTo: [] }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps the catch_all refusal', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'x' }, 400, { 'X-Frogmail-Error': 'forward_requires_domain' }))
    const error = await failure(
      make(fetchImpl).createInboundRoute({
        address: '*@mail.example.com',
        forwardUrl: null,
        forwardTo: ['a@b.org'],
        description: 'd',
      })
    )
    expect(error.code).toBe('forward_requires_domain')
  })
})
