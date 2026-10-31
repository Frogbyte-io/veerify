import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { lookupExistingMxHosts, refreshExistingMxHosts, receivingMxTarget } =
  await import('~/server/utils/mail-domain-mx')

const NOW = new Date('2026-10-31T12:00:00Z')
const google = [
  { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
  { exchange: 'aspmx.l.google.com', priority: 1 },
]
const dnsError = (code: string) => Object.assign(new Error(code), { code })

describe('lookupExistingMxHosts', () => {
  it('returns the current hosts, minus the SES inbound host', async () => {
    const resolveMx = vi.fn(async () => [...google, { exchange: 'inbound-smtp.us-east-1.amazonaws.com', priority: 10 }])
    expect(await lookupExistingMxHosts('acme.com', { resolveMx })).toEqual([
      'aspmx.l.google.com',
      'alt1.aspmx.l.google.com',
    ])
    expect(resolveMx).toHaveBeenCalledWith('acme.com')
  })

  it('treats "no MX records" as an empty list', async () => {
    for (const code of ['ENODATA', 'ENOTFOUND']) {
      expect(
        await lookupExistingMxHosts('new.example', { resolveMx: async () => Promise.reject(dnsError(code)) })
      ).toEqual([])
    }
  })

  it('returns null (never throws) on a DNS failure or a timeout', async () => {
    expect(
      await lookupExistingMxHosts('acme.com', { resolveMx: async () => Promise.reject(dnsError('ESERVFAIL')) })
    ).toBeNull()
    const hang = () => new Promise<never>(() => {})
    expect(await lookupExistingMxHosts('acme.com', { resolveMx: hang, timeoutMs: 10 })).toBeNull()
  })
})

describe('receivingMxTarget', () => {
  it('uses the MX record name Frogmail gave, else the claimed domain', () => {
    expect(receivingMxTarget({ domain: 'mail.acme.com', dnsRecords: [] })).toEqual({
      name: 'mail.acme.com',
      values: [],
    })
    expect(
      receivingMxTarget({
        domain: 'mail.acme.com',
        dnsRecords: [
          { purpose: 'receiving', type: 'MX', name: 'mail.acme.com', value: 'inbound.example', status: 'unknown' },
        ],
      })
    ).toEqual({ name: 'mail.acme.com', values: ['inbound.example'] })
  })
})

describe('refreshExistingMxHosts', () => {
  it('stores the hosts with the check time', async () => {
    const store = vi.fn(async () => undefined)
    const hosts = await refreshExistingMxHosts(
      { id: 'd1', domain: 'acme.com', receivingStatus: 'pending_mx' },
      { resolveMx: async () => google, store, now: NOW }
    )
    expect(hosts).toEqual(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])
    expect(store).toHaveBeenCalledWith('d1', {
      existingMxHosts: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'],
      existingMxCheckedAt: NOW,
    })
  })

  it('stores an empty list for a domain without mail, so the warning is not shown', async () => {
    const store = vi.fn(async () => undefined)
    await refreshExistingMxHosts(
      { id: 'd1', domain: 'new.example', receivingStatus: null },
      { resolveMx: async () => Promise.reject(dnsError('ENODATA')), store, now: NOW }
    )
    expect(store).toHaveBeenCalledWith('d1', { existingMxHosts: [], existingMxCheckedAt: NOW })
  })

  it('keeps the previous answer when the lookup fails', async () => {
    const store = vi.fn(async () => undefined)
    const hosts = await refreshExistingMxHosts(
      { id: 'd1', domain: 'acme.com', receivingStatus: 'pending_mx' },
      { resolveMx: async () => Promise.reject(dnsError('ETIMEOUT')), store }
    )
    expect(hosts).toBeNull()
    expect(store).not.toHaveBeenCalled()
  })

  it('skips the lookup once receiving is active', async () => {
    const resolveMx = vi.fn(async () => google)
    const store = vi.fn(async () => undefined)
    expect(
      await refreshExistingMxHosts({ id: 'd1', domain: 'acme.com', receivingStatus: 'active' }, { resolveMx, store })
    ).toBeUndefined()
    expect(resolveMx).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })

  it('never throws when storing fails', async () => {
    const store = vi.fn(async () => Promise.reject(new Error('db down')))
    await expect(
      refreshExistingMxHosts({ id: 'd1', domain: 'acme.com' }, { resolveMx: async () => google, store })
    ).resolves.toEqual(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])
  })
})
