import { describe, expect, it, vi } from 'vitest'
import type { DomainProviderResult } from '~/server/services/domains/provider'
import {
  missingHostnameResult,
  runDomainStatusRefresh,
  type DueDomain,
  type RefreshProvider,
  type RefreshStore,
} from '~/server/services/domains/status-refresh'

const now = new Date('2026-10-25T12:00:00.000Z')

const due = (hostname: string, over: Partial<DueDomain> = {}): DueDomain => ({
  id: `row-${hostname}`,
  projectId: `project-${hostname}`,
  organizationId: 'org-1',
  projectName: 'Acme feedback',
  hostname,
  providerDomainId: `cf-${hostname}`,
  status: 'dns_required',
  dnsRecords: [{ type: 'CNAME', name: hostname, value: 'cname.veerify.io' }],
  ...over,
})

const result = (hostname: string, status: DomainProviderResult['status']): DomainProviderResult => ({
  hostname,
  provider: 'cloudflare-saas',
  verified: status === 'active',
  status,
  dnsRecords: [{ type: 'CNAME', name: hostname, value: 'cname.veerify.io' }],
  configuredBy: 'CNAME',
  expected: 'cname.veerify.io',
  resolvedTo: [],
  message: status === 'error' ? 'Certificate is not usable (expired)' : null,
  providerDomainId: `cf-${hostname}`,
})

function setup(rows: DueDomain[], cloudflare: Record<string, DomainProviderResult | Error | null>) {
  const applied: Array<{ hostname: string; status: string }> = []
  const touched: string[] = []
  const notifyFor = new Set<string>()
  const store: RefreshStore = {
    listDue: vi.fn(async () => rows),
    touch: async (domain) => {
      touched.push(domain.hostname)
    },
    apply: async (domain, res) => {
      applied.push({ hostname: domain.hostname, status: res.status })
      return notifyFor.has(domain.hostname)
    },
    listOrganizationAdmins: async () => [
      { email: 'owner@acme.com', name: 'Owner' },
      { email: 'admin@acme.com', name: null },
    ],
  }
  const lookup = vi.fn(async ({ hostname }: { hostname: string }) => {
    const entry = cloudflare[hostname]
    if (entry instanceof Error) throw entry
    return entry ?? null
  })
  const provider: RefreshProvider = {
    isZoneHostname: async (hostname) => hostname.endsWith('.veerify.io'),
    lookupProjectDomain: lookup,
  }
  const sendVerifiedEmail = vi.fn(async () => ({ success: true }) as never)
  const run = () => runDomainStatusRefresh({ provider, store, sendVerifiedEmail, now })
  return { store, lookup, applied, touched, notifyFor, sendVerifiedEmail, run }
}

describe('runDomainStatusRefresh', () => {
  it('records Cloudflare status for each due domain', async () => {
    const ctx = setup([due('live.acme.com', { status: 'active' }), due('waiting.acme.com')], {
      'live.acme.com': result('live.acme.com', 'active'),
      'waiting.acme.com': result('waiting.acme.com', 'dns_required'),
    })

    const summary = await ctx.run()

    expect(ctx.lookup).toHaveBeenCalledWith({ hostname: 'live.acme.com', providerDomainId: 'cf-live.acme.com' })
    expect(ctx.applied).toEqual([
      { hostname: 'live.acme.com', status: 'active' },
      { hostname: 'waiting.acme.com', status: 'dns_required' },
    ])
    expect(summary).toMatchObject({ checked: 2, changed: 0, activated: 0, failed: 0, notified: 0 })
  })

  it('emails every organization owner and admin when a domain goes live and the store says to notify', async () => {
    const ctx = setup([due('new.acme.com')], { 'new.acme.com': result('new.acme.com', 'active') })
    ctx.notifyFor.add('new.acme.com')

    const summary = await ctx.run()

    expect(summary).toMatchObject({ changed: 1, activated: 1, notified: 2 })
    expect(ctx.sendVerifiedEmail).toHaveBeenCalledWith({
      to: 'owner@acme.com',
      name: 'Owner',
      projectName: 'Acme feedback',
      domain: 'new.acme.com',
    })
    expect(ctx.sendVerifiedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@acme.com', name: 'there' }))
  })

  it('sends nothing when the store says the email already went out', async () => {
    const ctx = setup([due('new.acme.com')], { 'new.acme.com': result('new.acme.com', 'active') })
    await ctx.run()
    expect(ctx.sendVerifiedEmail).not.toHaveBeenCalled()
  })

  it('keeps going when one email fails', async () => {
    const ctx = setup([due('new.acme.com')], { 'new.acme.com': result('new.acme.com', 'active') })
    ctx.notifyFor.add('new.acme.com')
    ctx.sendVerifiedEmail.mockRejectedValueOnce(new Error('smtp down'))
    const summary = await ctx.run()
    expect(summary.notified).toBe(1)
  })

  it('marks an active domain as an error when its certificate is no longer usable', async () => {
    const ctx = setup([due('live.acme.com', { status: 'active' })], {
      'live.acme.com': result('live.acme.com', 'error'),
    })
    const summary = await ctx.run()
    expect(ctx.applied).toEqual([{ hostname: 'live.acme.com', status: 'error' }])
    expect(summary).toMatchObject({ changed: 1, activated: 0 })
  })

  it('reports a hostname Cloudflare no longer has as an error, keeping its DNS records', async () => {
    const row = due('gone.acme.com', { status: 'active' })
    const ctx = setup([row], { 'gone.acme.com': null })
    await ctx.run()
    expect(ctx.applied).toEqual([{ hostname: 'gone.acme.com', status: 'error' }])
    expect(missingHostnameResult(row)).toMatchObject({
      verified: false,
      dnsRecords: row.dnsRecords,
      message: expect.stringContaining('Click Verify'),
    })
  })

  it('only records the check for hostnames inside the zone', async () => {
    const ctx = setup([due('feedback.veerify.io', { status: 'active' })], {})
    const summary = await ctx.run()
    expect(ctx.lookup).not.toHaveBeenCalled()
    expect(ctx.applied).toEqual([])
    expect(ctx.touched).toEqual(['feedback.veerify.io'])
    expect(summary.skippedZone).toBe(1)
  })

  it('keeps the status of a row whose lookup fails and moves on to the next', async () => {
    const ctx = setup([due('broken.acme.com'), due('ok.acme.com')], {
      'broken.acme.com': Object.assign(new Error('Cloudflare rejected the request: bad hostname'), { statusCode: 502 }),
      'ok.acme.com': result('ok.acme.com', 'dns_required'),
    })
    const summary = await ctx.run()
    expect(ctx.touched).toEqual(['broken.acme.com'])
    expect(ctx.applied).toEqual([{ hostname: 'ok.acme.com', status: 'dns_required' }])
    expect(summary).toMatchObject({ failed: 1, checked: 1, stoppedEarly: false })
  })

  it.each([
    ['rate limiting', Object.assign(new Error('Cloudflare is rate limiting domain changes'), { statusCode: 429 })],
    [
      'a rejected token',
      Object.assign(new Error('Cloudflare rejected the API token. It must be valid'), { statusCode: 502 }),
    ],
  ])('stops the run on %s', async (_label, error) => {
    const ctx = setup([due('a.acme.com'), due('b.acme.com')], {
      'a.acme.com': error,
      'b.acme.com': result('b.acme.com', 'active'),
    })
    const summary = await ctx.run()
    expect(ctx.lookup).toHaveBeenCalledTimes(1)
    expect(ctx.applied).toEqual([])
    expect(summary).toMatchObject({ failed: 1, stoppedEarly: true })
  })

  it('asks the store for one batch', async () => {
    const ctx = setup([], {})
    await runDomainStatusRefresh({
      provider: { isZoneHostname: async () => false, lookupProjectDomain: async () => null },
      store: ctx.store,
      now,
      limit: 7,
    })
    expect(ctx.store.listDue).toHaveBeenCalledWith(now, 7)
  })
})
