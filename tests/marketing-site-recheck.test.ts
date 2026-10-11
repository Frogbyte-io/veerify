import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { recheckVerifiedSites, DOMAIN_LOST_MESSAGE, isRecheckDue, RECHECK_INTERVAL_MS, RECHECK_RETRY_MS } =
  await import('~/server/services/marketing/site-recheck')

const now = new Date('2026-10-10T12:00:00Z')
const site = (over = {}) => ({
  id: 's1',
  projectId: 'p1',
  origin: 'https://acme.com',
  verificationToken: 'tok',
  verificationMethod: 'domain',
  lastVerificationError: null,
  verifiedAt: new Date('2026-08-01T00:00:00Z'),
  verificationCheckedAt: new Date('2026-08-01T00:00:00Z'),
  verificationFailures: 0,
  ...over,
})

function setup(opts: { domainSites?: unknown[]; due?: unknown[]; domains?: string[]; verified?: boolean }) {
  const update = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {})
  const check = vi.fn(async () => ({ verified: opts.verified ?? true, detail: 'nope' }))
  const deps = {
    now: () => now,
    listDomainSites: async () => (opts.domainSites ?? []) as never,
    listDueSites: async () => (opts.due ?? []) as never,
    activeDomains: async () => opts.domains ?? [],
    check,
    update: update as never,
  }
  return { deps, update, check }
}

describe('recheckVerifiedSites', () => {
  it('keeps domain sites still covered by an active domain', async () => {
    const { deps, update } = setup({ domainSites: [site()], domains: ['app.acme.com'] })
    expect(await recheckVerifiedSites(deps)).toEqual({ unverified: 0, checked: 0 })
    expect(update).not.toHaveBeenCalled()
  })

  it('unverifies domain sites whose domain is gone', async () => {
    const { deps, update } = setup({ domainSites: [site()], domains: [] })
    expect((await recheckVerifiedSites(deps)).unverified).toBe(1)
    expect(update).toHaveBeenCalledWith('s1', {
      verifiedAt: null,
      lastVerificationError: DOMAIN_LOST_MESSAGE,
      verificationCheckedAt: now,
      verificationFailures: 0,
    })
  })

  it('resets the failure counter when the token method still passes', async () => {
    const { deps, update, check } = setup({
      due: [site({ verificationMethod: 'meta', verificationFailures: 1, lastVerificationError: 'Re-check failed: x' })],
    })
    await recheckVerifiedSites(deps)
    expect(check).toHaveBeenCalledWith('https://acme.com', 'tok', 'meta')
    expect(update).toHaveBeenCalledWith('s1', {
      lastVerificationError: null,
      verificationCheckedAt: now,
      verificationFailures: 0,
    })
  })

  it('keeps the site verified after one failure and counts it', async () => {
    const { deps, update } = setup({ due: [site({ verificationMethod: 'dns' })], verified: false })
    expect((await recheckVerifiedSites(deps)).unverified).toBe(0)
    const patch = update.mock.calls[0][1] as Record<string, unknown>
    expect(patch.verifiedAt).toBeUndefined()
    expect(patch).toMatchObject({ verificationFailures: 1, verificationCheckedAt: now })
    expect(patch.lastVerificationError).toBe('Re-check failed: nope')
  })

  it('unverifies after a second consecutive failure', async () => {
    const { deps, update } = setup({
      due: [site({ verificationMethod: 'file', verificationFailures: 1 })],
      verified: false,
    })
    expect((await recheckVerifiedSites(deps)).unverified).toBe(1)
    expect(update.mock.calls[0][1]).toMatchObject({ verifiedAt: null, verificationFailures: 2 })
  })

  it('skips sites the due filter returns but that are not actually due', async () => {
    const { deps, check } = setup({
      due: [site({ verificationMethod: 'dns', verificationCheckedAt: new Date(now.getTime() - 1000) })],
    })
    expect((await recheckVerifiedSites(deps)).checked).toBe(0)
    expect(check).not.toHaveBeenCalled()
  })
})

describe('isRecheckDue', () => {
  const ago = (ms: number) => new Date(now.getTime() - ms)
  it('is monthly after a success', () => {
    expect(isRecheckDue(site({ verificationCheckedAt: ago(RECHECK_INTERVAL_MS - 1000) }), now)).toBe(false)
    expect(isRecheckDue(site({ verificationCheckedAt: ago(RECHECK_INTERVAL_MS + 1000) }), now)).toBe(true)
  })
  it('retries a failed re-check after a day, based on the last check', () => {
    expect(
      isRecheckDue(site({ verificationFailures: 1, verificationCheckedAt: ago(RECHECK_RETRY_MS - 1000) }), now)
    ).toBe(false)
    expect(
      isRecheckDue(site({ verificationFailures: 1, verificationCheckedAt: ago(RECHECK_RETRY_MS + 1000) }), now)
    ).toBe(true)
  })
  it('falls back to verifiedAt when never re-checked (pre-column rows)', () => {
    const old = ago(RECHECK_INTERVAL_MS + 1000)
    expect(isRecheckDue(site({ verificationCheckedAt: null, verifiedAt: old }), now)).toBe(true)
    expect(isRecheckDue(site({ verificationCheckedAt: null, verifiedAt: ago(1000) }), now)).toBe(false)
  })
  it('editing the site (updatedAt) is irrelevant', () => {
    expect(isRecheckDue(site({ verificationCheckedAt: ago(RECHECK_INTERVAL_MS + 1000), updatedAt: now }), now)).toBe(
      true
    )
  })
})
