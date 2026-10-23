import { describe, expect, it, vi } from 'vitest'
import {
  parseArgs,
  runSync,
  type SyncDomainRow,
  type SyncProvider,
  type SyncStore,
} from '../scripts/sync-cloudflare-custom-hostnames'
import type { DomainProviderResult } from '../server/services/domains/provider'

const result = (
  hostname: string,
  id: string,
  status: DomainProviderResult['status'] = 'active'
): DomainProviderResult => ({
  hostname,
  provider: 'cloudflare-saas',
  verified: status === 'active',
  status,
  dnsRecords: [],
  configuredBy: 'CNAME',
  expected: 'cname.veerify.io',
  resolvedTo: [],
  message: null,
  providerDomainId: id,
})

const row = (hostname: string, over: Partial<SyncDomainRow> = {}): SyncDomainRow => ({
  id: `row-${hostname}`,
  projectId: 'p1',
  hostname,
  provider: 'static-cname',
  providerDomainId: null,
  status: 'active',
  activatedAt: new Date('2026-09-01'),
  ...over,
})

function setup(rows: SyncDomainRow[], cloudflare: Record<string, DomainProviderResult>) {
  const applied: Array<{ hostname: string; providerDomainId?: string | null }> = []
  const store: SyncStore = {
    listDomains: async () => rows,
    applyResult: async (r, res) => {
      applied.push({ hostname: r.hostname, providerDomainId: res.providerDomainId })
    },
  }
  const registerProjectDomain = vi.fn(async ({ hostname }: { hostname: string }) =>
    result(hostname, `new-${hostname}`, 'dns_required')
  )
  const provider: SyncProvider = {
    lookupProjectDomain: async ({ hostname }) => cloudflare[hostname] ?? null,
    registerProjectDomain,
    listCustomHostnames: async () =>
      Object.values(cloudflare).map((r) => ({
        id: r.providerDomainId!,
        hostname: r.hostname,
        status: 'active',
        sslStatus: 'active',
      })),
    isZoneHostname: async (hostname) => hostname === 'veerify.io' || hostname.endsWith('.veerify.io'),
  }
  return { store, provider, applied, registerProjectDomain }
}

const run = (apply: boolean, ctx: ReturnType<typeof setup>) =>
  runSync({ apply, provider: ctx.provider, store: ctx.store, sleep: async () => {} })

describe('sync-cloudflare-custom-hostnames', () => {
  it('skips hostnames inside the zone and never looks them up or registers them', async () => {
    const ctx = setup([row('feedback.veerify.io', { provider: 'vercel' })], {})
    const lookup = vi.spyOn(ctx.provider, 'lookupProjectDomain')

    for (const apply of [false, true]) {
      const report = await run(apply, ctx)
      expect(report.entries).toEqual([
        expect.objectContaining({ hostname: 'feedback.veerify.io', action: 'skipped_zone' }),
      ])
      expect(report.summary.skipped_zone).toBe(1)
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(ctx.registerProjectDomain).not.toHaveBeenCalled()
    expect(ctx.applied).toEqual([])
  })

  it('dry run reports adoption and registration without writing or registering', async () => {
    const ctx = setup([row('feedback.dotmatrixlabs.com'), row('new.acme.com', { status: 'dns_required' })], {
      'feedback.dotmatrixlabs.com': result('feedback.dotmatrixlabs.com', 'cf-1'),
    })
    const report = await run(false, ctx)

    expect(report.mode).toBe('dry-run')
    expect(report.entries.map((e) => [e.hostname, e.action])).toEqual([
      ['feedback.dotmatrixlabs.com', 'would_adopt'],
      ['new.acme.com', 'would_register'],
    ])
    expect(ctx.applied).toEqual([])
    expect(ctx.registerProjectDomain).not.toHaveBeenCalled()
  })

  it('apply adopts the existing hostname and registers the missing one', async () => {
    const ctx = setup([row('feedback.dotmatrixlabs.com'), row('new.acme.com', { status: 'dns_required' })], {
      'feedback.dotmatrixlabs.com': result('feedback.dotmatrixlabs.com', 'cf-1'),
    })
    const report = await run(true, ctx)

    expect(report.entries.map((e) => e.action)).toEqual(['adopted', 'registered'])
    expect(ctx.applied).toEqual([
      { hostname: 'feedback.dotmatrixlabs.com', providerDomainId: 'cf-1' },
      { hostname: 'new.acme.com', providerDomainId: 'new-new.acme.com' },
    ])
    expect(ctx.registerProjectDomain).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: rows already recorded are in_sync and not rewritten', async () => {
    const ctx = setup(
      [row('feedback.dotmatrixlabs.com', { provider: 'cloudflare-saas', providerDomainId: 'cf-1', status: 'active' })],
      { 'feedback.dotmatrixlabs.com': result('feedback.dotmatrixlabs.com', 'cf-1') }
    )
    const report = await run(true, ctx)
    expect(report.entries[0].action).toBe('in_sync')
    expect(ctx.applied).toEqual([])
  })

  it('lists Cloudflare hostnames without a Veerify row and never deletes', async () => {
    const ctx = setup([row('feedback.dotmatrixlabs.com')], {
      'feedback.dotmatrixlabs.com': result('feedback.dotmatrixlabs.com', 'cf-1'),
      'stray.example.com': result('stray.example.com', 'cf-2'),
    })
    const report = await run(true, ctx)
    expect(report.orphans.map((o) => o.hostname)).toEqual(['stray.example.com'])
    expect(report.summary.orphans).toBe(1)
    expect(Object.keys(ctx.provider)).not.toContain('removeProjectDomain')
  })

  it('skips local development domains and records per-row errors', async () => {
    const ctx = setup([row('feedback.demo.localhost'), row('boom.acme.com')], {})
    ctx.provider.lookupProjectDomain = async ({ hostname }) => {
      if (hostname === 'boom.acme.com')
        throw Object.assign(new Error('x'), { statusMessage: 'Cloudflare is rate limiting' })
      return null
    }
    const report = await run(false, ctx)
    expect(report.entries.map((e) => e.action)).toEqual(['skipped_local', 'error'])
    expect(report.entries[1].reason).toContain('rate limiting')
    expect(report.summary.error).toBe(1)
  })

  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, production: false })
    expect(parseArgs(['--apply', '--i-know-this-is-production', '--json'])).toMatchObject({
      apply: true,
      production: true,
      json: true,
    })
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/)
  })
})
