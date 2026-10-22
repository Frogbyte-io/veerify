import { describe, expect, it, vi } from 'vitest'

// WP1/WP2 modules are not part of this branch; every collaborator is mocked.
vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => null) }))
vi.mock('~/server/services/sending-domains/ownership', () => ({
  checkOwnershipTxt: vi.fn(async () => 'valid'),
  checkDmarc: vi.fn(async () => null),
  ownershipRecord: (domain: string, token: string) => ({
    purpose: 'ownership',
    type: 'TXT',
    name: `_veerify-mail.${domain}`,
    value: `veerify-mail-verification=${token}`,
    status: 'unknown',
  }),
}))
vi.mock('~/server/utils/sending-domains', () => ({
  isSendingDomainsEnabled: vi.fn(() => true),
  resolveSenderPolicy: vi.fn(() => 'team'),
}))
vi.mock('~/lib/support-sending-domains', async () => {
  const actual = await vi.importActual<typeof import('~/lib/support-sending-domains')>('~/lib/support-sending-domains')
  // Minimal stand-in for WP1's pure status transition: verified needs both signals.
  return {
    ...actual,
    applyProviderResult: (
      row: { status: string; verifiedAt: Date | null },
      result: { state: string },
      ownership: string,
      now: Date
    ) => {
      const ok = result.state === 'active' && ownership === 'valid'
      if (ok) return { status: 'verified', verifiedAt: row.verifiedAt ?? now, providerState: 'active' }
      if (row.status === 'verified') return { status: 'suspended', providerState: result.state }
      return { status: row.status, providerState: result.state }
    },
  }
})

const {
  computePendingNextCheckAt,
  computeRegisterBackoffAt,
  computeRetryAfterAt,
  computeVerifiedNextCheckAt,
  checkSendingDomainClaim,
  registerSendingDomainClaim,
  removeSendingDomainClaim,
  runSendingDomainPoll,
  MAX_REGISTER_ATTEMPTS,
} = await import('~/server/utils/sending-domain-poller')
const { SendingDomainProviderError } = await import('~/server/services/sending-domains/types')

type Row = Parameters<typeof registerSendingDomainClaim>[0]
type Provider = Parameters<typeof registerSendingDomainClaim>[1]

const NOW = new Date('2026-10-22T12:00:00.000Z')
const minutes = (n: number) => n * 60_000

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'sd-1',
    teamId: 'team-1',
    domain: 'acme.com',
    registrableDomain: 'acme.com',
    status: 'pending',
    provider: 'mailgun',
    providerAccountKey: 'acct',
    providerOwnership: 'created',
    providerState: 'unverified',
    receivesViaProvider: false,
    ownershipToken: 'tok',
    ownershipVerifiedAt: null,
    ownershipFailures: 0,
    providerFailures: 0,
    dnsRecords: [],
    verifiedAt: null,
    lastCheckedAt: null,
    nextCheckAt: NOW,
    leaseExpiresAt: null,
    attemptCount: 0,
    lastErrorCode: null,
    lastError: null,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * minutes(1)),
    createdByUserId: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Row
}

const activeResult = { domain: 'acme.com', state: 'active', receivesMail: false, records: [], message: null }

function makeProvider(overrides: Record<string, unknown> = {}): Provider & Record<string, ReturnType<typeof vi.fn>> {
  return {
    name: 'mailgun',
    accountKey: 'acct',
    capabilities: { register: true, verifyNow: true, remove: true, inboundRoutes: true, authorizesSubdomains: true },
    isConfigured: vi.fn(() => ({ configured: true, missing: [] })),
    register: vi.fn(async () => ({ ...activeResult, state: 'unverified', ownership: 'created' })),
    get: vi.fn(async () => activeResult),
    verify: vi.fn(async () => activeResult),
    remove: vi.fn(async () => ({ cleanup: null })),
    ...overrides,
  } as never
}

describe('schedule', () => {
  it('checks pending claims every 5 min for an hour, 15 min until 24 h, then hourly', () => {
    const created = NOW
    const at = (ageMs: number) => {
      const now = new Date(created.getTime() + ageMs)
      return computePendingNextCheckAt(created, null, now).getTime() - now.getTime()
    }
    expect(at(0)).toBe(minutes(5))
    expect(at(minutes(59))).toBe(minutes(5))
    expect(at(minutes(60))).toBe(minutes(15))
    expect(at(minutes(23 * 60))).toBe(minutes(15))
    expect(at(minutes(24 * 60))).toBe(minutes(60))
  })

  it('never schedules a pending check past expiry', () => {
    const expiresAt = new Date(NOW.getTime() + minutes(2))
    expect(computePendingNextCheckAt(NOW, expiresAt, NOW)).toEqual(expiresAt)
  })

  it('re-checks verified claims every 24 hours', () => {
    expect(computeVerifiedNextCheckAt(NOW).getTime() - NOW.getTime()).toBe(24 * 60 * minutes(1))
  })

  it('backs off failed registrations 5, 10, 20 ... minutes up to 6 hours with +-20% jitter', () => {
    const delay = (attempt: number, random: number) =>
      computeRegisterBackoffAt(attempt, NOW, () => random).getTime() - NOW.getTime()
    expect(delay(1, 0.5)).toBe(minutes(5))
    expect(delay(2, 0.5)).toBe(minutes(10))
    expect(delay(3, 0.5)).toBe(minutes(20))
    expect(delay(20, 0.5)).toBe(minutes(360))
    expect(delay(1, 0)).toBe(minutes(4))
    expect(delay(1, 1)).toBe(minutes(6))
  })

  it('honours Retry-After and clamps it', () => {
    expect(computeRetryAfterAt(90, NOW).getTime() - NOW.getTime()).toBe(90_000)
    expect(computeRetryAfterAt(undefined, NOW).getTime() - NOW.getTime()).toBe(60_000)
    expect(computeRetryAfterAt(10 ** 9, NOW).getTime() - NOW.getTime()).toBe(6 * 60 * 60_000)
  })
})

describe('registerSendingDomainClaim', () => {
  it('moves a registered claim to pending with the ownership record first', async () => {
    const provider = makeProvider({
      register: vi.fn(async () => ({
        ...activeResult,
        state: 'unverified',
        ownership: 'adopted',
        records: [
          {
            purpose: 'receiving',
            type: 'MX',
            name: 'acme.com',
            value: 'mx.example',
            priority: '10',
            status: 'unknown',
          },
          { purpose: 'sending', type: 'CNAME', name: 'k1._domainkey.acme.com', value: 'k1.example', status: 'unknown' },
        ],
      })),
    })
    const outcome = await registerSendingDomainClaim(row({ status: 'provisioning' }), provider, { now: NOW })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.patch).toMatchObject({ status: 'pending', providerOwnership: 'adopted', attemptCount: 0 })
    expect(outcome.patch.dnsRecords?.map((r) => r.purpose)).toEqual(['ownership', 'sending', 'receiving'])
  })

  it('counts transient failures and backs off', async () => {
    const provider = makeProvider({
      register: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'boom', true)
      }),
    })
    const outcome = await registerSendingDomainClaim(row({ status: 'provisioning', attemptCount: 1 }), provider, {
      now: NOW,
      random: () => 0.5,
    })
    expect(outcome).toMatchObject({ kind: 'transient', rateLimited: false })
    if (outcome.kind !== 'transient') return
    expect(outcome.patch).toMatchObject({ status: 'failed', attemptCount: 2, lastErrorCode: 'provider_unavailable' })
    expect(outcome.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + minutes(10)))
  })

  it('stops automatic retries after the attempt budget, waking only at expiry', async () => {
    const provider = makeProvider({
      register: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'boom', true)
      }),
    })
    const expiresAt = new Date(NOW.getTime() + minutes(1000))
    const outcome = await registerSendingDomainClaim(
      row({ status: 'failed', attemptCount: MAX_REGISTER_ATTEMPTS - 1, expiresAt }),
      provider,
      { now: NOW }
    )
    if (outcome.kind !== 'transient') throw new Error('expected transient')
    expect(outcome.patch.attemptCount).toBe(MAX_REGISTER_ATTEMPTS)
    expect(outcome.patch.nextCheckAt).toEqual(expiresAt)
  })

  it('does not count a rate-limited attempt and waits for Retry-After', async () => {
    const provider = makeProvider({
      register: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow down', true, 120)
      }),
    })
    const outcome = await registerSendingDomainClaim(row({ status: 'failed', attemptCount: 3 }), provider, { now: NOW })
    if (outcome.kind !== 'transient') throw new Error('expected transient')
    expect(outcome.rateLimited).toBe(true)
    expect(outcome.patch.attemptCount).toBeUndefined()
    expect(outcome.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + 120_000))
  })

  it.each([
    ['owned_elsewhere', 'rejected', 'owned_elsewhere'],
    ['invalid_domain', 'rejected', 'invalid_domain'],
    ['missing_scope', 'misconfigured', 'missing_scope'],
    ['unauthorized', 'misconfigured', 'unauthorized'],
  ] as const)('maps provider error %s to %s', async (code, kind, expectedCode) => {
    const provider = makeProvider({
      register: vi.fn(async () => {
        throw new SendingDomainProviderError(code, 'nope', false)
      }),
    })
    const outcome = await registerSendingDomainClaim(row({ status: 'provisioning' }), provider, { now: NOW })
    expect(outcome).toMatchObject({ kind, code: expectedCode })
  })

  it('treats an escaped network error as transient', async () => {
    const provider = makeProvider({
      register: vi.fn(async () => {
        throw new Error('socket hang up')
      }),
    })
    const outcome = await registerSendingDomainClaim(row({ status: 'provisioning' }), provider, { now: NOW })
    expect(outcome.kind).toBe('transient')
  })
})

describe('checkSendingDomainClaim', () => {
  it('verifies a pending claim when TXT and provider both pass', async () => {
    const outcome = await checkSendingDomainClaim(row(), makeProvider(), { now: NOW })
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBe('verified')
    expect(outcome.patch).toMatchObject({ status: 'verified', expiresAt: null, leaseExpiresAt: null })
    expect(outcome.patch.nextCheckAt).toEqual(computeVerifiedNextCheckAt(NOW))
    expect(outcome.patch.dnsRecords?.[0]).toMatchObject({ purpose: 'ownership', status: 'valid' })
  })

  it('keeps a contested domain pending and records why, even when TXT passes', async () => {
    const contested = {
      ...activeResult,
      state: 'unverified',
      contested: true,
      message: 'Another service already sends from this domain.',
    }
    const outcome = await checkSendingDomainClaim(row(), makeProvider({ get: vi.fn(async () => contested) }), {
      now: NOW,
    })
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBeNull()
    expect(outcome.patch).toMatchObject({
      status: 'pending',
      providerState: 'unverified',
      lastErrorCode: 'owned_elsewhere',
      lastError: 'Another service already sends from this domain.',
    })
  })

  it('clears the contested reason once the provider reports the domain as ours', async () => {
    const outcome = await checkSendingDomainClaim(
      row({ lastErrorCode: 'owned_elsewhere', lastError: 'Another service already sends from this domain.' }),
      makeProvider(),
      { now: NOW }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.patch).toMatchObject({ status: 'verified', lastErrorCode: null, lastError: null })
  })

  it('uses get() for polls and verify() only for a manual check', async () => {
    const provider = makeProvider()
    await checkSendingDomainClaim(row(), provider, { now: NOW })
    expect(provider.get).toHaveBeenCalledTimes(1)
    expect(provider.verify).not.toHaveBeenCalled()
    await checkSendingDomainClaim(row(), provider, { now: NOW, manual: true })
    expect(provider.verify).toHaveBeenCalledTimes(1)
  })

  it('stays pending and reschedules when the ownership TXT is missing', async () => {
    const outcome = await checkSendingDomainClaim(row(), makeProvider(), {
      now: NOW,
      checkOwnership: vi.fn(async () => 'invalid' as const),
    })
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBeNull()
    expect(outcome.patch.status).toBe('pending')
    expect(outcome.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + minutes(5)))
  })

  it('suspends a verified claim that stops passing', async () => {
    const outcome = await checkSendingDomainClaim(
      row({ status: 'verified', verifiedAt: NOW, expiresAt: null }),
      makeProvider(),
      { now: NOW, checkOwnership: vi.fn(async () => 'invalid' as const) }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBe('suspended')
  })

  it('asks for a new registration when a pending domain vanished at the provider', async () => {
    const provider = makeProvider({ get: vi.fn(async () => null) })
    expect(await checkSendingDomainClaim(row(), provider, { now: NOW })).toEqual({ kind: 'needs_register' })
  })

  it('reschedules on provider_unavailable without changing status, and honours Retry-After', async () => {
    const unavailable = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'down', true)
      }),
    })
    const a = await checkSendingDomainClaim(row({ status: 'verified' }), unavailable, { now: NOW, random: () => 0.5 })
    if (a.kind !== 'provider_error' || !a.patch) throw new Error('expected provider_error with patch')
    expect(a.patch.status).toBeUndefined()
    expect(a.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + minutes(5)))

    const limited = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 300)
      }),
    })
    const b = await checkSendingDomainClaim(row(), limited, { now: NOW })
    if (b.kind !== 'provider_error' || !b.patch) throw new Error('expected provider_error with patch')
    expect(b.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + 300_000))
  })

  it('changes nothing for a credential failure', async () => {
    const provider = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('missing_scope', 'scope', false)
      }),
    })
    const outcome = await checkSendingDomainClaim(row(), provider, { now: NOW })
    expect(outcome).toMatchObject({ kind: 'provider_error', patch: null })
  })
})

describe('removeSendingDomainClaim', () => {
  const deleteRoutes = vi.fn(async () => undefined)

  it('removes a domain Veerify created', async () => {
    const provider = makeProvider()
    const outcome = await removeSendingDomainClaim(row(), provider, { now: NOW, deleteRoutes })
    expect(outcome).toEqual({ kind: 'deleted', operatorCleanupRequired: false })
    expect(provider.remove).toHaveBeenCalledWith('acme.com')
  })

  it.each([['adopted'], [null]] as const)(
    'never removes the provider domain when ownership is %s',
    async (ownership) => {
      const provider = makeProvider()
      const outcome = await removeSendingDomainClaim(row({ providerOwnership: ownership }), provider, {
        now: NOW,
        deleteRoutes,
      })
      expect(outcome.kind).toBe('deleted')
      expect(provider.remove).not.toHaveBeenCalled()
    }
  )

  it('does not touch another provider project after a configuration switch', async () => {
    const provider = makeProvider()
    await removeSendingDomainClaim(row({ providerAccountKey: 'other' }), provider, { now: NOW, deleteRoutes })
    expect(provider.remove).not.toHaveBeenCalled()
  })

  it('treats not_found as removed and receiving_enabled as released with operator cleanup', async () => {
    const notFound = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('not_found', 'gone', false)
      }),
    })
    expect(await removeSendingDomainClaim(row(), notFound, { now: NOW, deleteRoutes })).toEqual({
      kind: 'deleted',
      operatorCleanupRequired: false,
    })
    const receiving = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('receiving_enabled', 'receives mail', false)
      }),
    })
    expect(await removeSendingDomainClaim(row(), receiving, { now: NOW, deleteRoutes })).toEqual({
      kind: 'deleted',
      operatorCleanupRequired: true,
    })
  })

  it('keeps the row in deleting and retries on a transient error', async () => {
    const provider = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'down', true)
      }),
    })
    const outcome = await removeSendingDomainClaim(row({ status: 'deleting' }), provider, {
      now: NOW,
      deleteRoutes,
      random: () => 0.5,
    })
    if (outcome.kind !== 'retry') throw new Error('expected retry')
    expect(outcome.patch).toMatchObject({ status: 'deleting', attemptCount: 1 })
    expect(outcome.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + minutes(5)))
  })

  it('keeps the status untouched for an expiry retry', async () => {
    const provider = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'down', true)
      }),
    })
    const outcome = await removeSendingDomainClaim(row(), provider, { now: NOW, deleteRoutes, keepStatus: true })
    if (outcome.kind !== 'retry') throw new Error('expected retry')
    expect(outcome.patch.status).toBeUndefined()
  })
})

describe('runSendingDomainPoll', () => {
  function harness(rows: Row[], providerOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    const queue = [...rows]
    const saved: { id: string; patch: Record<string, unknown> }[] = []
    const deleted: string[] = []
    const released: string[][] = []
    const metrics: { name: string; fields: unknown }[] = []
    const provider = makeProvider(providerOverrides)
    const deps = {
      clock: () => NOW,
      random: () => 0.5,
      enabled: () => true,
      policy: () => 'team' as const,
      provider,
      claim: vi.fn(async ({ limit }: { limit: number }) => queue.splice(0, limit)),
      save: vi.fn(async (r: Row, patch: Record<string, unknown>) => {
        saved.push({ id: r.id, patch })
        return true
      }),
      deleteRow: vi.fn(async (r: Row) => {
        deleted.push(r.id)
      }),
      release: vi.fn(async (ids: string[]) => {
        released.push(ids)
      }),
      detach: vi.fn(async () => 0),
      deleteRoutes: vi.fn(async () => undefined),
      checkOwnership: vi.fn(async () => 'valid' as const),
      checkDmarcRecord: vi.fn(async () => null),
      metric: vi.fn((name: string, fields: unknown) => {
        metrics.push({ name, fields })
        return true
      }),
      ...extra,
    }
    return { deps, provider, saved, deleted, released, metrics }
  }

  it('is a no-op when the feature is disabled or the provider is unconfigured', async () => {
    const h = harness([row()])
    expect(await runSendingDomainPoll({ ...h.deps, enabled: () => false })).toMatchObject({ skipped: 'disabled' })
    expect(await runSendingDomainPoll({ ...h.deps, provider: null })).toMatchObject({
      skipped: 'provider_unconfigured',
    })
    expect(h.deps.claim).not.toHaveBeenCalled()
  })

  it('dispatches by status', async () => {
    const h = harness([
      row({ id: 'prov', status: 'provisioning' }),
      row({ id: 'pend', status: 'pending' }),
      row({ id: 'del', status: 'deleting' }),
    ])
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary).toMatchObject({ claimed: 3, processed: 3, registered: 1, verified: 1, deleted: 1, aborted: null })
    expect(h.provider.register).toHaveBeenCalledTimes(1)
    expect(h.provider.remove).toHaveBeenCalledTimes(1)
    expect(h.deleted).toEqual(['del'])
    expect(h.metrics.map((m) => m.name)).toEqual(
      expect.arrayContaining(['support.sending_domain.verified', 'support.sending_domain.deleted'])
    )
  })

  it('detaches other teams addresses on a verify only under team policy', async () => {
    const team = harness([row()])
    await runSendingDomainPoll(team.deps)
    expect(team.deps.detach).toHaveBeenCalledTimes(1)

    const legacy = harness([row()], {}, { policy: () => 'legacy' as const })
    await runSendingDomainPoll(legacy.deps)
    expect(legacy.deps.detach).not.toHaveBeenCalled()
  })

  it('expires a pending claim: removes a created provider domain, then deletes the row', async () => {
    const h = harness([row({ expiresAt: new Date(NOW.getTime() - 1000) })])
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.expired).toBe(1)
    expect(h.provider.remove).toHaveBeenCalledWith('acme.com')
    expect(h.provider.get).not.toHaveBeenCalled()
    expect(h.deleted).toEqual(['sd-1'])
    expect(h.metrics.map((m) => m.name)).toContain('support.sending_domain.expired')
  })

  it('does not expire verified claims', async () => {
    const h = harness([row({ status: 'verified', verifiedAt: NOW, expiresAt: new Date(NOW.getTime() - 1000) })])
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.expired).toBe(0)
    expect(h.deleted).toEqual([])
  })

  it('leaves mismatched verified claims alone and does not call the provider', async () => {
    const h = harness([row({ status: 'verified', verifiedAt: NOW, expiresAt: null, providerAccountKey: 'old' })])
    await runSendingDomainPoll(h.deps)
    expect(h.provider.get).not.toHaveBeenCalled()
    expect(h.saved[0]!.patch.nextCheckAt).toEqual(computeVerifiedNextCheckAt(NOW))
  })

  it('re-registers a pending claim after a provider switch', async () => {
    const h = harness([row({ providerAccountKey: 'old' })])
    await runSendingDomainPoll(h.deps)
    expect(h.provider.register).toHaveBeenCalledTimes(1)
  })

  it('deletes a claim whose registration is permanently refused', async () => {
    const h = harness([row({ status: 'provisioning' })], {
      register: vi.fn(async () => {
        throw new SendingDomainProviderError('owned_elsewhere', 'taken', false)
      }),
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.failed).toBe(1)
    expect(h.deleted).toEqual(['sd-1'])
  })

  it('stops the circuit breaker after 3 consecutive provider_unavailable results and releases the rest', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ id: `sd-${i}`, domain: `d${i}.com` }))
    const h = harness(
      rows,
      {
        get: vi.fn(async () => {
          throw new SendingDomainProviderError('provider_unavailable', 'down', true)
        }),
      },
      { batchSize: 25 }
    )
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.aborted).toBe('circuit_breaker')
    expect(h.provider.get).toHaveBeenCalledTimes(3)
    expect(h.released).toEqual([['sd-3', 'sd-4', 'sd-5']])
  })

  it('does not trip the breaker on rate limiting, and does not count it as an attempt', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `sd-${i}`, domain: `d${i}.com` }))
    const h = harness(rows, {
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 30)
      }),
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary).toMatchObject({ aborted: null, rateLimited: 5, processed: 5 })
    expect(h.saved.every((s) => (s.patch.nextCheckAt as Date).getTime() === NOW.getTime() + 30_000)).toBe(true)
  })

  it('aborts on missing_scope without changing any row, and records the metric', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', domain: 'b.com' })]
    const h = harness(rows, {
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('missing_scope', 'scope', false)
      }),
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.aborted).toBe('provider_misconfigured')
    expect(h.saved).toEqual([])
    expect(h.deleted).toEqual([])
    expect(h.released).toEqual([['a', 'b']])
    expect(h.metrics.map((m) => m.name)).toContain('support.sending_domain.provider_misconfigured')
  })

  it('stops starting work once the time budget is spent', async () => {
    let tick = 0
    const rows = Array.from({ length: 4 }, (_, i) => row({ id: `sd-${i}`, domain: `d${i}.com` }))
    const h = harness(rows, {}, { clock: () => new Date(NOW.getTime() + tick), budgetMs: 45_000 })
    h.deps.save.mockImplementation(async () => {
      tick += 20_000
      return true
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary.aborted).toBe('time_budget')
    expect(summary.processed).toBe(3)
    expect(h.released).toEqual([['sd-3']])
  })

  it('isolates an unexpected error to one row', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', domain: 'b.com' })]
    const h = harness(rows)
    let calls = 0
    h.deps.save.mockImplementation(async (r: Row, patch: Record<string, unknown>) => {
      if (calls++ === 0) throw new TypeError('database went away')
      h.saved.push({ id: r.id, patch })
      return true
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary).toMatchObject({ processed: 1, failed: 1, aborted: null })
    expect(h.saved[0]).toMatchObject({ id: 'a', patch: { lastErrorCode: 'internal_error' } })
    expect(h.saved[1]!.id).toBe('b')
  })
})
