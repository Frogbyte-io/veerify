import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudflareSaasDomainProvider,
  mapCloudflareHostname,
  type CloudflareCustomHostname,
} from '~/server/services/domains/providers/cloudflare-saas'

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

const TOKEN = 'cf-secret-token-123'
const TARGET = 'cname.veerify.io'

interface Call {
  url: string
  method: string
  body: Record<string, unknown> | null
  auth: string | null
}

type Reply = { status?: number; result?: unknown; errors?: Array<{ code?: number; message?: string }> }

function mockFetch(handler: (call: Call) => Reply) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
    }
    calls.push(call)
    const reply = handler(call)
    const status = reply.status ?? 200
    return new Response(
      JSON.stringify({ success: status < 400, errors: reply.errors || [], result: reply.result ?? null }),
      { status }
    )
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

function provider(fetchImpl: typeof fetch) {
  return new CloudflareSaasDomainProvider({ fetch: fetchImpl, apiToken: TOKEN, zoneId: 'zone123', cnameTarget: TARGET })
}

const hostnameRecord = (over: Partial<CloudflareCustomHostname> = {}): CloudflareCustomHostname => ({
  id: 'cf-id-1',
  hostname: 'feedback.acme.com',
  status: 'pending',
  ssl: { status: 'pending_validation', method: 'http' },
  ...over,
})

const BASE = 'https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames'

describe('CloudflareSaasDomainProvider', () => {
  let activeRecord: CloudflareCustomHostname
  beforeEach(() => {
    activeRecord = hostnameRecord({ status: 'active', ssl: { status: 'active' } })
  })

  it('registers a hostname with http DV and returns the CNAME plus the id', async () => {
    const { fn, calls } = mockFetch(() => ({
      result: hostnameRecord({
        ownership_verification: { name: '_cf-custom-hostname.feedback.acme.com', type: 'txt', value: 'abc-123' },
        ssl: {
          status: 'pending_validation',
          validation_records: [{ txt_name: '_acme-challenge.feedback.acme.com', txt_value: 'xyz' }],
        },
      }),
    }))

    const result = await provider(fn).registerProjectDomain({ hostname: 'Feedback.Acme.com.' })

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(BASE)
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].body).toMatchObject({
      hostname: 'feedback.acme.com',
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    })
    expect(result).toMatchObject({
      provider: 'cloudflare-saas',
      providerDomainId: 'cf-id-1',
      status: 'dns_required',
      verified: false,
      expected: TARGET,
    })
    expect(result.dnsRecords).toEqual([
      { type: 'CNAME', name: 'feedback.acme.com', value: TARGET },
      { type: 'TXT', name: '_cf-custom-hostname.feedback.acme.com', value: 'abc-123' },
      { type: 'TXT', name: '_acme-challenge.feedback.acme.com', value: 'xyz' },
    ])
  })

  it('adopts an existing hostname when the create call reports a duplicate', async () => {
    const { fn, calls } = mockFetch((call) =>
      call.method === 'POST'
        ? { status: 409, errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }] }
        : { result: [{ ...activeRecord, id: 'existing-id', hostname: 'feedback.acme.com' }] }
    )

    const result = await provider(fn).registerProjectDomain({ hostname: 'feedback.acme.com' })

    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET'])
    expect(calls[1].url).toBe(`${BASE}?hostname=feedback.acme.com&per_page=50`)
    expect(result).toMatchObject({ status: 'active', verified: true, providerDomainId: 'existing-id' })
    expect(result.dnsRecords).toEqual([{ type: 'CNAME', name: 'feedback.acme.com', value: TARGET }])
  })

  it('treats a duplicate message as a duplicate even without the code', async () => {
    const { fn } = mockFetch((call) =>
      call.method === 'POST'
        ? { status: 400, errors: [{ message: 'Duplicate custom hostname found.' }] }
        : { result: [activeRecord] }
    )
    await expect(provider(fn).registerProjectDomain({ hostname: 'feedback.acme.com' })).resolves.toMatchObject({
      status: 'active',
    })
  })

  it('fails clearly when a duplicate cannot be looked up', async () => {
    const { fn } = mockFetch((call) =>
      call.method === 'POST' ? { status: 409, errors: [{ code: 1406 }] } : { result: [] }
    )
    await expect(provider(fn).registerProjectDomain({ hostname: 'feedback.acme.com' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('ignores lookup results for other hostnames', async () => {
    const { fn } = mockFetch(() => ({ result: [hostnameRecord({ hostname: 'other.acme.com' })] }))
    expect(await provider(fn).lookupProjectDomain({ hostname: 'feedback.acme.com' })).toBeNull()
  })

  it('looks up by stored id, falling back to the hostname when the id is stale', async () => {
    const { fn, calls } = mockFetch((call) =>
      call.url.endsWith('/stale-id')
        ? { status: 404, errors: [{ code: 1409, message: 'not found' }] }
        : { result: [activeRecord] }
    )
    const result = await provider(fn).getProjectDomainStatus({
      hostname: 'feedback.acme.com',
      providerDomainId: 'stale-id',
    })
    expect(calls[0].url).toBe(`${BASE}/stale-id`)
    expect(calls[1].url).toContain('?hostname=feedback.acme.com')
    expect(result.status).toBe('active')
  })

  it('uses the stored id directly when it resolves', async () => {
    const { fn, calls } = mockFetch(() => ({ result: activeRecord }))
    const result = await provider(fn).getProjectDomainStatus({
      hostname: 'feedback.acme.com',
      providerDomainId: 'cf-id-1',
    })
    expect(calls).toHaveLength(1)
    expect(result).toMatchObject({ status: 'active', providerDomainId: 'cf-id-1' })
  })

  it('adopts a hostname by name when the row has no id yet (switch from static-cname)', async () => {
    const { fn, calls } = mockFetch(() => ({ result: [activeRecord] }))
    const result = await provider(fn).getProjectDomainStatus({ hostname: 'feedback.acme.com', providerDomainId: null })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
    expect(result).toMatchObject({ provider: 'cloudflare-saas', status: 'active', providerDomainId: 'cf-id-1' })
  })

  it('registers a hostname that Cloudflare does not know yet when checking status', async () => {
    const { fn, calls } = mockFetch((call) => (call.method === 'GET' ? { result: [] } : { result: hostnameRecord() }))
    const result = await provider(fn).getProjectDomainStatus({ hostname: 'feedback.acme.com' })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(result.status).toBe('dns_required')
  })

  it('verify re-triggers validation with PATCH when not active', async () => {
    const { fn, calls } = mockFetch((call) => {
      if (call.method === 'PATCH') return { result: { ...activeRecord } }
      return { result: [hostnameRecord()] }
    })
    const result = await provider(fn).verifyProjectDomain({ hostname: 'feedback.acme.com' })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(calls[1].url).toBe(`${BASE}/cf-id-1`)
    expect(calls[1].body).toEqual({ ssl: { method: 'http', type: 'dv' } })
    expect(result.status).toBe('active')
  })

  it('verify does not PATCH an already active hostname', async () => {
    const { fn, calls } = mockFetch(() => ({ result: [activeRecord] }))
    const result = await provider(fn).verifyProjectDomain({ hostname: 'feedback.acme.com' })
    expect(calls.map((c) => c.method)).toEqual(['GET'])
    expect(result.verified).toBe(true)
  })

  it('deletes by stored id', async () => {
    const { fn, calls } = mockFetch(() => ({ result: activeRecord }))
    await provider(fn).removeProjectDomain({ hostname: 'feedback.acme.com', providerDomainId: 'cf-id-1' })
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BASE}/cf-id-1`, `DELETE ${BASE}/cf-id-1`])
  })

  it('treats a 404 on delete as success', async () => {
    const { fn } = mockFetch((call) =>
      call.method === 'DELETE' ? { status: 404, errors: [{ message: 'gone' }] } : { result: [activeRecord] }
    )
    await expect(provider(fn).removeProjectDomain({ hostname: 'feedback.acme.com' })).resolves.toBeUndefined()
  })

  it('treats a hostname that no longer exists as already removed', async () => {
    const { fn, calls } = mockFetch(() => ({ result: [] }))
    await provider(fn).removeProjectDomain({ hostname: 'feedback.acme.com' })
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('lists every hostname across pages', async () => {
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => hostnameRecord({ id: `id-${n}-${i}`, hostname: `h${n}-${i}.acme.com` }))
    const { fn, calls } = mockFetch((call) => ({ result: call.url.endsWith('&page=1') ? page(1, 100) : page(2, 3) }))
    const all = await provider(fn).listCustomHostnames()
    expect(all).toHaveLength(103)
    expect(calls).toHaveLength(2)
  })

  describe('errors', () => {
    const cases: Array<[number, number, RegExp]> = [
      [401, 502, /rejected the API token/],
      [403, 502, /SSL and Certificates: Edit/],
      [429, 429, /rate limiting/],
      [500, 502, /temporarily unavailable/],
      [503, 502, /temporarily unavailable/],
    ]

    it.each(cases)(
      'maps HTTP %i to a clear %i error without leaking the token',
      async (status, statusCode, pattern) => {
        const { fn } = mockFetch(() => ({ status, errors: [{ code: 9109, message: `bad ${TOKEN}` }] }))
        const error = await provider(fn)
          .registerProjectDomain({ hostname: 'feedback.acme.com' })
          .catch((e) => e)
        expect(error.statusCode).toBe(statusCode)
        expect(error.statusMessage).toMatch(pattern)
        expect(JSON.stringify(error.statusMessage)).not.toContain(TOKEN)
      }
    )

    it('maps a network failure to 502', async () => {
      const fn = vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
      await expect(provider(fn).getProjectDomainStatus({ hostname: 'feedback.acme.com' })).rejects.toMatchObject({
        statusCode: 502,
      })
    })

    it('errors when not configured', async () => {
      const unconfigured = new CloudflareSaasDomainProvider({ apiToken: '', zoneId: '', cnameTarget: TARGET })
      await expect(unconfigured.registerProjectDomain({ hostname: 'feedback.acme.com' })).rejects.toMatchObject({
        statusCode: 500,
      })
    })
  })
})

describe('mapCloudflareHostname status mapping', () => {
  const map = (status: string, ssl: string, extra: Partial<CloudflareCustomHostname> = {}) =>
    mapCloudflareHostname(
      'feedback.acme.com',
      { id: 'x', ...extra, status, ssl: { ...(extra.ssl || {}), status: ssl } },
      TARGET
    )

  it('is active only when both hostname and ssl are active', () => {
    expect(map('active', 'active')).toMatchObject({ status: 'active', verified: true, message: null })
    for (const ssl of ['pending_validation', 'pending_issuance', 'pending_deployment', 'initializing']) {
      const result = map('active', ssl)
      expect(result.verified).toBe(false)
      expect(result.status).toBe('dns_required')
      expect(result.message).toContain(ssl)
    }
    expect(map('pending', 'active').verified).toBe(false)
  })

  it('keeps a live hostname active while Cloudflare redeploys its config', () => {
    expect(map('active_redeploying', 'active')).toMatchObject({ status: 'active', verified: true })
    expect(map('active_redeploying', 'pending_deployment').verified).toBe(false)
  })

  it('keeps pending hostnames at dns_required', () => {
    for (const status of [
      'pending',
      'pending_migration',
      'pending_provisioned',
      'provisioned',
      'test_pending',
      'active_redeploying',
    ]) {
      expect(map(status, 'initializing').status).toBe('dns_required')
    }
  })

  it('asks for ownership verification when Cloudflare reports non-CNAME verification errors', () => {
    const result = map('pending', 'pending_validation', { verification_errors: ['The ownership token was not found.'] })
    expect(result.status).toBe('ownership_verification_required')
    expect(result.message).toContain('ownership token')
  })

  it('stays on dns_required when the error is about the CNAME', () => {
    const result = map('pending', 'pending_validation', {
      verification_errors: ['Custom hostname does not CNAME to this zone.'],
    })
    expect(result.status).toBe('dns_required')
    expect(result.message).toContain('CNAME')
  })

  it('needs a TXT when an active hostname has ssl validation errors', () => {
    const result = map('active', 'pending_validation', {
      ssl: { validation_errors: [{ message: 'CAA blocks issuance' }] },
    })
    expect(result.status).toBe('ownership_verification_required')
    expect(result.message).toContain('CAA')
  })

  it('maps moved to dns_required', () => {
    expect(map('moved', 'active')).toMatchObject({ status: 'dns_required', verified: false })
  })

  it('maps blocked, deleted and timed out states to error', () => {
    for (const status of ['blocked', 'pending_blocked', 'test_blocked', 'test_failed', 'deleted', 'pending_deletion']) {
      expect(map(status, 'active').status).toBe('error')
    }
    for (const ssl of [
      'initializing_timed_out',
      'validation_timed_out',
      'issuance_timed_out',
      'deployment_timed_out',
    ]) {
      expect(map('pending', ssl).status).toBe('error')
      expect(map('active', ssl).status).toBe('error')
    }
    for (const ssl of ['expired', 'inactive', 'deleted', 'deactivating']) {
      expect(map('active', ssl).status).toBe('error')
    }
  })

  it('only emits the CNAME when active and keeps TXT records while pending', () => {
    expect(
      map('active', 'active', { ownership_verification: { name: 'n', type: 'txt', value: 'v' } }).dnsRecords
    ).toEqual([{ type: 'CNAME', name: 'feedback.acme.com', value: TARGET }])
    expect(
      map('pending', 'pending_validation', { ownership_verification: { name: 'n.acme.com', type: 'txt', value: 'v' } })
        .dnsRecords
    ).toHaveLength(2)
  })
})
