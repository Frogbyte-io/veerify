import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { recheckVerifiedSites, DOMAIN_LOST_MESSAGE, RECHECK_FAILURE_PREFIX, RECHECK_INTERVAL_MS, RECHECK_RETRY_MS } =
  await import('~/server/services/marketing/site-recheck')

const now = new Date('2026-10-10T12:00:00Z')
const site = (over = {}) => ({
  id: 's1',
  projectId: 'p1',
  origin: 'https://acme.com',
  verificationToken: 'tok',
  verificationMethod: 'domain',
  lastVerificationError: null,
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
      updatedAt: now,
    })
  })

  it('clears a stale failure marker when the token method still passes', async () => {
    const { deps, update, check } = setup({
      due: [site({ verificationMethod: 'meta', lastVerificationError: `${RECHECK_FAILURE_PREFIX}x` })],
    })
    await recheckVerifiedSites(deps)
    expect(check).toHaveBeenCalledWith('https://acme.com', 'tok', 'meta')
    expect(update).toHaveBeenCalledWith('s1', { lastVerificationError: null, updatedAt: now })
  })

  it('keeps the site verified after one failure and schedules a retry in a day', async () => {
    const { deps, update } = setup({ due: [site({ verificationMethod: 'dns' })], verified: false })
    expect((await recheckVerifiedSites(deps)).unverified).toBe(0)
    const patch = update.mock.calls[0][1] as { verifiedAt?: null; updatedAt: Date; lastVerificationError: string }
    expect(patch.verifiedAt).toBeUndefined()
    expect(patch.lastVerificationError.startsWith(RECHECK_FAILURE_PREFIX)).toBe(true)
    expect(now.getTime() - patch.updatedAt.getTime()).toBe(RECHECK_INTERVAL_MS - RECHECK_RETRY_MS)
  })

  it('unverifies after a second consecutive failure', async () => {
    const { deps, update } = setup({
      due: [site({ verificationMethod: 'file', lastVerificationError: `${RECHECK_FAILURE_PREFIX}x` })],
      verified: false,
    })
    expect((await recheckVerifiedSites(deps)).unverified).toBe(1)
    expect(update.mock.calls[0][1]).toMatchObject({ verifiedAt: null })
  })
})
