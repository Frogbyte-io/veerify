import { describe, expect, it, vi } from 'vitest'

import { PostmarkSendingDomainProvider } from '../server/services/sending-domains/providers/postmark'
import type { FetchImpl } from '../server/services/support-channels/types'
import { SendingDomainProviderError } from '../server/services/sending-domains/types'

const TOKEN = 'account-token-secret'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const list = {
  TotalCount: 3,
  Domains: [
    { Name: 'acme.com', DKIMVerified: true, ReturnPathDomainVerified: true },
    { Name: 'half.com', DKIMVerified: true, ReturnPathDomainVerified: false },
    { Name: 'Other.IO', DKIMVerified: true, ReturnPathDomainVerified: true },
  ],
}

function make(fetchImpl: ReturnType<typeof vi.fn>) {
  return new PostmarkSendingDomainProvider({
    apiToken: TOKEN,
    accountKey: 'acct',
    fetchImpl: fetchImpl as unknown as FetchImpl,
  })
}

describe('postmark list-only provider', () => {
  it('declares no management capabilities', () => {
    expect(make(vi.fn()).capabilities).toEqual({
      register: false,
      verifyNow: false,
      remove: false,
      inboundRoutes: false,
      authorizesSubdomains: false,
    })
  })

  it('reports missing settings by name', () => {
    expect(new PostmarkSendingDomainProvider({ apiToken: '', accountKey: '' }).isConfigured()).toEqual({
      configured: false,
      missing: ['SUPPORT_POSTMARK_ACCOUNT_TOKEN', 'SUPPORT_POSTMARK_ACCOUNT_KEY'],
    })
    expect(make(vi.fn()).isConfigured().configured).toBe(true)
  })

  it('register lists domains with the account token and adopts', async () => {
    const fetchImpl = vi.fn(async () => json(list))
    const result = await make(fetchImpl).register('Acme.com')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.postmarkapp.com/domains?count=500&offset=0')
    expect((init.headers as Record<string, string>)['X-Postmark-Account-Token']).toBe(TOKEN)
    expect(result).toMatchObject({
      domain: 'acme.com',
      state: 'active',
      receivesMail: false,
      records: [],
      ownership: 'adopted',
    })
    expect(result.message).toMatch(/operator adds this domain in Postmark/)
  })

  it('verify is active only when DKIM and return-path are both verified', async () => {
    const fetchImpl = vi.fn(async () => json(list))
    const provider = make(fetchImpl)
    expect((await provider.verify('acme.com')).state).toBe('active')
    expect((await provider.verify('half.com')).state).toBe('unverified')
    expect((await provider.verify('other.io')).state).toBe('active')
  })

  it('does not match parent or child domains', async () => {
    const fetchImpl = vi.fn(async () => json(list))
    const provider = make(fetchImpl)
    expect((await provider.verify('mail.acme.com')).state).toBe('unverified')
    expect((await provider.verify('cme.com')).state).toBe('unverified')
    expect(await provider.get('mail.acme.com')).toBeNull()
    expect(await provider.get('badacme.com')).toBeNull()
  })

  it('get returns a result for a listed domain', async () => {
    const fetchImpl = vi.fn(async () => json(list))
    expect(await make(fetchImpl).get('half.com')).toMatchObject({ domain: 'half.com', state: 'unverified' })
  })

  it('remove does nothing and makes no request', async () => {
    const fetchImpl = vi.fn()
    expect(await make(fetchImpl).remove()).toEqual({ cleanup: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('pages through long lists', async () => {
    const page1 = { TotalCount: 501, Domains: Array.from({ length: 500 }, (_, i) => ({ Name: `d${i}.com` })) }
    const page2 = {
      TotalCount: 501,
      Domains: [{ Name: 'late.com', DKIMVerified: true, ReturnPathDomainVerified: true }],
    }
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json(page2))
    const result = await make(fetchImpl).verify('late.com')
    expect(result.state).toBe('active')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.postmarkapp.com/domains?count=500&offset=500')
  })

  describe('errors', () => {
    async function failure(promise: Promise<unknown>) {
      try {
        await promise
      } catch (error) {
        expect(error).toBeInstanceOf(SendingDomainProviderError)
        return error as SendingDomainProviderError
      }
      throw new Error('expected rejection')
    }

    it('maps 401 to unauthorized', async () => {
      const fetchImpl = vi.fn(async () => json({ Message: 'Invalid token' }, 401))
      expect(await failure(make(fetchImpl).verify('acme.com'))).toMatchObject({
        code: 'unauthorized',
        retryable: false,
      })
    })

    it('maps 429 with Retry-After', async () => {
      const fetchImpl = vi.fn(async () => json({ Message: 'slow' }, 429, { 'Retry-After': '12' }))
      expect(await failure(make(fetchImpl).verify('acme.com'))).toMatchObject({
        code: 'rate_limited',
        retryable: true,
        retryAfterSeconds: 12,
      })
    })

    it('maps 5xx and network failures to provider_unavailable', async () => {
      const down = vi.fn(async () => json({ Message: 'oops' }, 503))
      expect(await failure(make(down).verify('acme.com'))).toMatchObject({
        code: 'provider_unavailable',
        retryable: true,
      })
      const broken = vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
      expect((await failure(make(broken).verify('acme.com'))).code).toBe('provider_unavailable')
    })

    it('never includes the token in messages', async () => {
      const fetchImpl = vi.fn(async () => json({ Message: `bad ${TOKEN}` }, 400))
      const error = await failure(make(fetchImpl).verify('acme.com'))
      expect(error.message).not.toContain(TOKEN)
      expect(error.code).toBe('unknown')
    })
  })
})
