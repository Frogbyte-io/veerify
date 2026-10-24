import { describe, expect, it, vi } from 'vitest'

// Collaborators that touch the network or the database are mocked; the pure status machine is real.
const dbMock = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('~/server/database/drizzle', () => ({ db: dbMock }))
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
  resolveSenderPolicy: vi.fn(() => 'project'),
  resolveProjectSenderAuthorization: vi.fn(),
}))
const {
  computePendingNextCheckAt,
  computeRegisterBackoffAt,
  computeRetryAfterAt,
  computeVerifiedNextCheckAt,
  checkSendingDomainClaim,
  registerSendingDomainClaim,
  removeSendingDomainClaim,
  runSendingDomainPoll,
  saveSendingDomainPatch,
  MAX_REGISTER_ATTEMPTS,
  MAX_REMOVE_ATTEMPTS,
} = await import('~/server/utils/sending-domain-poller')
const { SUSPENDED_TTL_DAYS, PENDING_TTL_DAYS } = await import('~/lib/support-sending-domains')
const { SendingDomainProviderError } = await import('~/server/services/sending-domains/types')

type Row = Parameters<typeof registerSendingDomainClaim>[0]
type Provider = Parameters<typeof registerSendingDomainClaim>[1]

const NOW = new Date('2026-10-22T12:00:00.000Z')
const minutes = (n: number) => n * 60_000

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'sd-1',
    projectId: 'project-1',
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
    const outcome = await registerSendingDomainClaim(
      row({ status: 'provisioning', providerOwnership: null }),
      provider,
      { now: NOW }
    )
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.patch).toMatchObject({ status: 'pending', providerOwnership: 'adopted', attemptCount: 0 })
    expect(outcome.patch.dnsRecords?.map((r) => r.purpose)).toEqual(['ownership', 'sending', 'receiving'])
  })

  describe('provider ownership', () => {
    const adopted = (records = []) =>
      makeProvider({
        register: vi.fn(async () => ({ ...activeResult, state: 'unverified', ownership: 'adopted', records })),
      })

    it('never downgrades a created domain to adopted', async () => {
      const outcome = await registerSendingDomainClaim(
        row({ status: 'provisioning', providerOwnership: 'created' }),
        adopted(),
        { now: NOW }
      )
      if (outcome.kind !== 'ok') throw new Error('expected ok')
      expect(outcome.patch.providerOwnership).toBe('created')
    })

    it('treats an adoption after one of our own failed register attempts as created', async () => {
      const outcome = await registerSendingDomainClaim(
        row({ status: 'failed', providerOwnership: null, attemptCount: 2 }),
        adopted(),
        { now: NOW }
      )
      if (outcome.kind !== 'ok') throw new Error('expected ok')
      expect(outcome.patch.providerOwnership).toBe('created')
    })

    it('keeps that evidence when an admin restarts the budget with Register again', async () => {
      const failing = makeProvider({
        register: vi.fn(async () => {
          throw new SendingDomainProviderError('provider_unavailable', 'down', true)
        }),
      })
      const claim = row({ status: 'failed', providerOwnership: null, attemptCount: MAX_REGISTER_ATTEMPTS })
      const retry = await registerSendingDomainClaim(claim, failing, { now: NOW, restartBudget: true })
      if (retry.kind !== 'transient') throw new Error('expected transient')
      expect(retry.patch.attemptCount).toBe(1)

      const outcome = await registerSendingDomainClaim(claim, adopted(), { now: NOW, restartBudget: true })
      if (outcome.kind !== 'ok') throw new Error('expected ok')
      expect(outcome.patch.providerOwnership).toBe('created')
    })

    it('records adopted for a domain that was there before any attempt of ours', async () => {
      const outcome = await registerSendingDomainClaim(
        row({ status: 'provisioning', providerOwnership: null, attemptCount: 0 }),
        adopted(),
        { now: NOW }
      )
      if (outcome.kind !== 'ok') throw new Error('expected ok')
      expect(outcome.patch.providerOwnership).toBe('adopted')
    })

    it('never infers created for a provider that cannot create or remove domains', async () => {
      const listOnly = makeProvider({
        capabilities: {
          register: false,
          verifyNow: false,
          remove: false,
          inboundRoutes: false,
          authorizesSubdomains: false,
        },
        register: vi.fn(async () => ({ ...activeResult, state: 'unverified', ownership: 'adopted' })),
      })
      const outcome = await registerSendingDomainClaim(
        row({ status: 'failed', providerOwnership: null, attemptCount: 3 }),
        listOnly,
        { now: NOW }
      )
      if (outcome.kind !== 'ok') throw new Error('expected ok')
      expect(outcome.patch.providerOwnership).toBe('adopted')
    })
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

  it('suspends a verified claim that stops passing, and keeps the reason', async () => {
    const outcome = await checkSendingDomainClaim(
      row({ status: 'verified', verifiedAt: NOW, expiresAt: null, ownershipFailures: 2 }),
      makeProvider(),
      { now: NOW, checkOwnership: vi.fn(async () => 'invalid' as const) }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBe('suspended')
    // The status machine's reason must reach the row, not be wiped by the poller.
    expect(outcome.patch).toMatchObject({
      status: 'suspended',
      lastErrorCode: 'ownership_missing',
      lastError: 'The Veerify ownership TXT record is no longer found in DNS.',
    })
    expect(outcome.patch.expiresAt).toEqual(new Date(NOW.getTime() + SUSPENDED_TTL_DAYS * 24 * 60 * minutes(1)))
  })

  it('keeps the provider_unverified reason on a suspended claim that stays suspended', async () => {
    const outcome = await checkSendingDomainClaim(
      row({ status: 'suspended', verifiedAt: NOW, expiresAt: new Date(NOW.getTime() + minutes(1000)) }),
      makeProvider({ get: vi.fn(async () => ({ ...activeResult, state: 'unverified' })) }),
      { now: NOW }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.patch).toMatchObject({ status: 'suspended', lastErrorCode: 'provider_unverified' })
    // The suspension clock is not restarted by each daily check.
    expect(outcome.patch.expiresAt).toEqual(new Date(NOW.getTime() + minutes(1000)))
  })

  it('keeps the contested message even when the claim is suspended at the same time', async () => {
    const outcome = await checkSendingDomainClaim(
      row({ status: 'verified', verifiedAt: NOW, expiresAt: null, providerFailures: 1 }),
      makeProvider({
        get: vi.fn(async () => ({ ...activeResult, state: 'unverified', contested: true, message: 'Used elsewhere.' })),
      }),
      { now: NOW }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.patch).toMatchObject({
      status: 'suspended',
      lastErrorCode: 'owned_elsewhere',
      lastError: 'Used elsewhere.',
    })
  })

  it('asks for a new registration when a pending domain vanished at the provider', async () => {
    const provider = makeProvider({ get: vi.fn(async () => null) })
    expect(await checkSendingDomainClaim(row(), provider, { now: NOW })).toEqual({ kind: 'needs_register' })
  })

  it('asks for a new registration when a suspended claim lost its provider domain', async () => {
    const provider = makeProvider({ get: vi.fn(async () => null) })
    const suspended = row({ status: 'suspended', verifiedAt: NOW, expiresAt: null })
    expect(await checkSendingDomainClaim(suspended, provider, { now: NOW })).toEqual({ kind: 'needs_register' })
  })

  it('re-registers on a manual verify when the provider domain is gone, whatever the status', async () => {
    const notFound = makeProvider({
      verify: vi.fn(async () => {
        throw new SendingDomainProviderError('not_found', 'gone', false)
      }),
    })
    for (const status of ['pending', 'suspended', 'verified'] as const) {
      const claim = row({ status, verifiedAt: NOW })
      expect(await checkSendingDomainClaim(claim, notFound, { now: NOW, manual: true })).toEqual({
        kind: 'needs_register',
      })
    }
  })

  it('still counts a vanished domain as unverified for a verified claim in the daily pass', async () => {
    const provider = makeProvider({ get: vi.fn(async () => null) })
    const outcome = await checkSendingDomainClaim(
      row({ status: 'verified', verifiedAt: NOW, expiresAt: null, providerFailures: 1 }),
      provider,
      { now: NOW }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.transition).toBe('suspended')
  })

  describe('list-only provider (Postmark)', () => {
    const listOnly = () =>
      makeProvider({
        capabilities: {
          register: false,
          verifyNow: false,
          remove: false,
          inboundRoutes: false,
          authorizesSubdomains: false,
        },
        get: vi.fn(async () => null),
      })

    it('treats "not listed yet" as unverified: runs the TXT and DMARC checks and stays pending', async () => {
      const checkOwnership = vi.fn(async () => 'valid' as const)
      const dmarc = {
        purpose: 'recommended',
        type: 'TXT',
        name: '_dmarc.acme.com',
        value: 'v=DMARC1; p=none',
        status: 'valid',
      }
      const checkDmarcRecord = vi.fn(async () => dmarc as never)
      const outcome = await checkSendingDomainClaim(row({ providerOwnership: 'adopted' }), listOnly(), {
        now: NOW,
        checkOwnership,
        checkDmarcRecord,
      })
      if (outcome.kind !== 'checked') throw new Error('expected checked, got ' + outcome.kind)
      expect(checkOwnership).toHaveBeenCalledTimes(1)
      expect(checkDmarcRecord).toHaveBeenCalledTimes(1)
      expect(outcome.transition).toBeNull()
      expect(outcome.patch).toMatchObject({ status: 'pending', providerState: 'unverified' })
      expect(outcome.patch.dnsRecords?.map((r) => r.purpose)).toEqual(['ownership', 'recommended'])
      expect(outcome.patch.dnsRecords?.[0]).toMatchObject({ status: 'valid' })
    })

    it('does not bounce a pending claim back to provisioning in the poller', async () => {
      const queue = [row({ providerOwnership: 'adopted' })]
      const saved: Record<string, unknown>[] = []
      await runSendingDomainPoll({
        clock: () => NOW,
        enabled: () => true,
        policy: () => 'project',
        provider: listOnly(),
        claim: async () => queue.splice(0, 25),
        save: async (_r, patch) => {
          saved.push(patch)
          return true
        },
        checkOwnership: async () => 'valid',
        checkDmarcRecord: async () => null,
        reconcileRoutes: async () => ({ created: 0, failed: 0, misconfigured: false }),
        metric: () => true,
      })
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({ status: 'pending' })
    })
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
    expect(a.patch.attemptCount).toBe(1)
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

  it('backs off a verified claim that keeps failing instead of retrying every 5 minutes', async () => {
    const unavailable = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('provider_unavailable', 'down', true)
      }),
    })
    const delayAfter = async (attemptCount: number) => {
      const outcome = await checkSendingDomainClaim(row({ status: 'verified', attemptCount }), unavailable, {
        now: NOW,
        random: () => 0.5,
      })
      if (outcome.kind !== 'provider_error' || !outcome.patch) throw new Error('expected provider_error with patch')
      return outcome.patch.nextCheckAt!.getTime() - NOW.getTime()
    }
    expect(await delayAfter(0)).toBe(minutes(5))
    expect(await delayAfter(1)).toBe(minutes(10))
    expect(await delayAfter(3)).toBe(minutes(40))
    expect(await delayAfter(6)).toBe(minutes(320))
    // After the budget the normal daily cadence takes over.
    expect(await delayAfter(MAX_REGISTER_ATTEMPTS)).toBe(24 * 60 * minutes(1))
  })

  it('falls back to the daily cadence for a non-retryable check error on a verified claim', async () => {
    const refused = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('unknown', 'bad request', false)
      }),
    })
    const outcome = await checkSendingDomainClaim(row({ status: 'verified' }), refused, { now: NOW })
    if (outcome.kind !== 'provider_error' || !outcome.patch) throw new Error('expected provider_error with patch')
    expect(outcome.patch.nextCheckAt).toEqual(computeVerifiedNextCheckAt(NOW))
  })

  it('does not count a rate-limited check as a failure', async () => {
    const limited = makeProvider({
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 30)
      }),
    })
    const outcome = await checkSendingDomainClaim(row({ status: 'verified', attemptCount: 2 }), limited, { now: NOW })
    if (outcome.kind !== 'provider_error' || !outcome.patch) throw new Error('expected provider_error with patch')
    expect(outcome.patch.attemptCount).toBeUndefined()
  })

  it('bases the pending cadence on the current pending period, not on createdAt', async () => {
    // Created long ago, re-registered one minute ago: expiresAt restarted the period.
    const longAgo = new Date(NOW.getTime() - 30 * 24 * 60 * minutes(1))
    const expiresAt = new Date(NOW.getTime() - minutes(1) + PENDING_TTL_DAYS * 24 * 60 * minutes(1))
    const outcome = await checkSendingDomainClaim(
      row({ createdAt: longAgo, expiresAt }),
      makeProvider({ get: vi.fn(async () => ({ ...activeResult, state: 'unverified' })) }),
      { now: NOW }
    )
    if (outcome.kind !== 'checked') throw new Error('expected checked')
    expect(outcome.patch.nextCheckAt).toEqual(new Date(NOW.getTime() + minutes(5)))
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

  it.each([
    ['owned_elsewhere', false],
    ['invalid_domain', false],
    ['unknown', false],
  ] as const)(
    'releases the row with an operator cleanup request on a permanent %s refusal',
    async (code, _retryable) => {
      const provider = makeProvider({
        remove: vi.fn(async () => {
          throw new SendingDomainProviderError(code, 'refused', false)
        }),
      })
      const outcome = await removeSendingDomainClaim(row({ status: 'deleting' }), provider, { now: NOW, deleteRoutes })
      expect(outcome).toEqual({ kind: 'deleted', operatorCleanupRequired: true })
    }
  )

  it('stops retrying a removal after the budget and asks the operator to clean up', async () => {
    for (const code of ['provider_unavailable', 'missing_scope'] as const) {
      const provider = makeProvider({
        remove: vi.fn(async () => {
          throw new SendingDomainProviderError(code, 'nope', code === 'provider_unavailable')
        }),
      })
      const last = await removeSendingDomainClaim(
        row({ status: 'deleting', attemptCount: MAX_REMOVE_ATTEMPTS - 1 }),
        provider,
        { now: NOW, deleteRoutes }
      )
      expect(last).toEqual({ kind: 'deleted', operatorCleanupRequired: true })
      const earlier = await removeSendingDomainClaim(
        row({ status: 'deleting', attemptCount: MAX_REMOVE_ATTEMPTS - 2 }),
        provider,
        { now: NOW, deleteRoutes }
      )
      expect(earlier.kind).toBe(code === 'missing_scope' ? 'misconfigured' : 'retry')
    }
  })

  it('does not spend the removal budget on rate limiting', async () => {
    const provider = makeProvider({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 30)
      }),
    })
    const outcome = await removeSendingDomainClaim(
      row({ status: 'deleting', attemptCount: MAX_REMOVE_ATTEMPTS - 1 }),
      provider,
      { now: NOW, deleteRoutes }
    )
    expect(outcome.kind).toBe('retry')
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
      policy: () => 'project' as const,
      provider,
      claim: vi.fn(async ({ limit }: { limit: number }) => queue.splice(0, limit)),
      save: vi.fn(async (r: Row, patch: Record<string, unknown>) => {
        saved.push({ id: r.id, patch })
        return true
      }),
      deleteRow: vi.fn(async (r: Row, _opts?: { expiredBy?: Date }) => {
        deleted.push(r.id)
        return true
      }),
      release: vi.fn(async (ids: string[]) => {
        released.push(ids)
      }),
      detach: vi.fn(async () => 0),
      reconcileRoutes: vi.fn(async () => ({ created: 0, failed: 0, misconfigured: false })),
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

  it('aborts the pass on the first rate_limited, saving Retry-After for that row and releasing the rest', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `sd-${i}`, domain: `d${i}.com` }))
    const h = harness(rows, {
      get: vi.fn(async () => {
        throw new SendingDomainProviderError('rate_limited', 'slow', true, 30)
      }),
    })
    const summary = await runSendingDomainPoll(h.deps)
    expect(summary).toMatchObject({ aborted: 'rate_limited', rateLimited: 1 })
    expect(h.provider.get).toHaveBeenCalledTimes(1)
    expect(h.saved).toHaveLength(1)
    expect((h.saved[0]!.patch.nextCheckAt as Date).getTime()).toBe(NOW.getTime() + 30_000)
    expect(h.saved[0]!.patch.attemptCount).toBeUndefined()
    expect(h.released).toEqual([['sd-0', 'sd-1', 'sd-2', 'sd-3', 'sd-4']])
  })

  it('aborts the pass on a rate-limited register and a rate-limited removal too', async () => {
    const limited = () => {
      throw new SendingDomainProviderError('rate_limited', 'slow', true, 30)
    }
    const register = harness(
      [row({ id: 'a', status: 'provisioning' }), row({ id: 'b', domain: 'b.com', status: 'provisioning' })],
      {
        register: vi.fn(async () => limited()),
      }
    )
    expect(await runSendingDomainPoll(register.deps)).toMatchObject({ aborted: 'rate_limited', rateLimited: 1 })
    expect(register.provider.register).toHaveBeenCalledTimes(1)

    const removal = harness(
      [row({ id: 'a', status: 'deleting' }), row({ id: 'b', domain: 'b.com', status: 'deleting' })],
      {
        remove: vi.fn(async () => limited()),
      }
    )
    expect(await runSendingDomainPoll(removal.deps)).toMatchObject({ aborted: 'rate_limited' })
    expect(removal.provider.remove).toHaveBeenCalledTimes(1)
    expect(removal.saved[0]!.patch).toMatchObject({ status: 'deleting', lastErrorCode: 'rate_limited' })
  })

  describe('removal that can never succeed', () => {
    const refusing = (code: 'owned_elsewhere' | 'missing_scope' | 'provider_unavailable') => ({
      remove: vi.fn(async () => {
        throw new SendingDomainProviderError(code, 'refused', code === 'provider_unavailable')
      }),
    })

    it('releases a deleting row on a permanent refusal and records operator cleanup', async () => {
      const h = harness([row({ status: 'deleting' })], refusing('owned_elsewhere'))
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary).toMatchObject({ deleted: 1, aborted: null })
      expect(h.deleted).toEqual(['sd-1'])
      expect(h.metrics.map((m) => m.name)).toEqual(
        expect.arrayContaining(['support.sending_domain.deleted', 'support.sending_domain.operator_cleanup_required'])
      )
    })

    it('releases an expired claim on a permanent refusal too', async () => {
      const h = harness([row({ expiresAt: new Date(NOW.getTime() - 1000) })], refusing('owned_elsewhere'))
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary.expired).toBe(1)
      expect(h.deleted).toEqual(['sd-1'])
      expect(h.metrics.map((m) => m.name)).toContain('support.sending_domain.operator_cleanup_required')
    })

    it('counts a credential failure: saves the attempt, aborts the pass, and eventually releases the row', async () => {
      const first = harness([row({ status: 'deleting', attemptCount: 2 })], refusing('missing_scope'))
      const summary = await runSendingDomainPoll(first.deps)
      expect(summary.aborted).toBe('provider_misconfigured')
      expect(first.saved).toHaveLength(1)
      expect(first.saved[0]!.patch).toMatchObject({
        status: 'deleting',
        attemptCount: 3,
        lastErrorCode: 'missing_scope',
      })
      expect(first.deleted).toEqual([])

      const last = harness(
        [row({ status: 'deleting', attemptCount: MAX_REMOVE_ATTEMPTS - 1 })],
        refusing('missing_scope')
      )
      const done = await runSendingDomainPoll(last.deps)
      expect(done).toMatchObject({ deleted: 1, aborted: null })
      expect(last.deleted).toEqual(['sd-1'])
      expect(last.metrics.map((m) => m.name)).toContain('support.sending_domain.operator_cleanup_required')
    })

    it('stops retrying a transient failure after the budget', async () => {
      const h = harness(
        [row({ status: 'deleting', attemptCount: MAX_REMOVE_ATTEMPTS - 1 })],
        refusing('provider_unavailable')
      )
      await runSendingDomainPoll(h.deps)
      expect(h.deleted).toEqual(['sd-1'])
    })
  })

  describe('expiry', () => {
    it('is guarded by expiresAt <= now so a concurrent re-registration is not deleted', async () => {
      const h = harness([row({ expiresAt: new Date(NOW.getTime() - 1000) })])
      await runSendingDomainPoll(h.deps)
      expect(h.deps.deleteRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'sd-1', status: 'pending' }), {
        expiredBy: NOW,
      })
    })

    it('does not count or report an expiry whose guarded delete matched nothing', async () => {
      const h = harness(
        [row({ expiresAt: new Date(NOW.getTime() - 1000) })],
        {},
        { deleteRow: vi.fn(async () => false) }
      )
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary.expired).toBe(0)
      expect(h.metrics.map((m) => m.name)).not.toContain('support.sending_domain.expired')
    })

    it('expires a suspended claim like a pending one', async () => {
      const h = harness([
        row({
          status: 'suspended',
          verifiedAt: NOW,
          expiresAt: new Date(NOW.getTime() - 1000),
          providerOwnership: 'adopted',
        }),
      ])
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary.expired).toBe(1)
      expect(h.deleted).toEqual(['sd-1'])
      expect(h.provider.get).not.toHaveBeenCalled()
    })

    it('does not expire a suspended claim before its time', async () => {
      const h = harness([
        row({ status: 'suspended', verifiedAt: NOW, expiresAt: new Date(NOW.getTime() + minutes(60)) }),
      ])
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary.expired).toBe(0)
      expect(h.deleted).toEqual([])
    })
  })

  describe('provider domain gone', () => {
    it('re-registers a suspended claim with a fresh pending period', async () => {
      const h = harness(
        [row({ status: 'suspended', verifiedAt: NOW, expiresAt: new Date(NOW.getTime() + minutes(100)) })],
        { get: vi.fn(async () => null) }
      )
      await runSendingDomainPoll(h.deps)
      expect(h.saved[0]!.patch).toMatchObject({ status: 'provisioning', nextCheckAt: NOW })
      expect((h.saved[0]!.patch.expiresAt as Date).getTime()).toBe(
        NOW.getTime() + PENDING_TTL_DAYS * 24 * 60 * minutes(1)
      )
    })

    it('keeps `created` through the needs_register path', async () => {
      const h = harness([row({ status: 'provisioning', providerOwnership: 'created', attemptCount: 0 })], {
        register: vi.fn(async () => ({ ...activeResult, state: 'unverified', ownership: 'adopted' })),
      })
      await runSendingDomainPoll(h.deps)
      expect(h.saved[0]!.patch).toMatchObject({ status: 'pending', providerOwnership: 'created' })
    })
  })

  describe('direct-receiving routes (§9.2)', () => {
    const receiving = { ...activeResult, receivesMail: true }

    it('reconciles routes for a verified claim that receives via the provider', async () => {
      const h = harness([row({ status: 'verified', verifiedAt: NOW, expiresAt: null })], {
        get: vi.fn(async () => receiving),
      })
      await runSendingDomainPoll(h.deps)
      expect(h.deps.reconcileRoutes).toHaveBeenCalledTimes(1)
    })

    it('reconciles for a claim that just verified, but not when it does not receive or is not verified', async () => {
      const verifying = harness([row()], { get: vi.fn(async () => receiving) })
      await runSendingDomainPoll(verifying.deps)
      expect(verifying.deps.reconcileRoutes).toHaveBeenCalledTimes(1)

      const noReceive = harness([row({ status: 'verified', verifiedAt: NOW, expiresAt: null })])
      await runSendingDomainPoll(noReceive.deps)
      expect(noReceive.deps.reconcileRoutes).not.toHaveBeenCalled()

      const pending = harness([row()], { get: vi.fn(async () => ({ ...receiving, state: 'unverified' })) })
      await runSendingDomainPoll(pending.deps)
      expect(pending.deps.reconcileRoutes).not.toHaveBeenCalled()
    })

    it('records provider_misconfigured once on a missing scope and does not fail the row', async () => {
      const rows = [
        row({ id: 'a', status: 'verified', verifiedAt: NOW, expiresAt: null }),
        row({ id: 'b', domain: 'b.com', status: 'verified', verifiedAt: NOW, expiresAt: null }),
      ]
      const h = harness(
        rows,
        { get: vi.fn(async () => receiving) },
        {
          reconcileRoutes: vi.fn(async () => ({ created: 0, failed: 0, misconfigured: true })),
        }
      )
      const summary = await runSendingDomainPoll(h.deps)
      expect(summary).toMatchObject({ processed: 2, failed: 0, aborted: null })
      expect(h.deps.reconcileRoutes).toHaveBeenCalledTimes(1)
      expect(h.metrics.filter((m) => m.name === 'support.sending_domain.provider_misconfigured')).toHaveLength(1)
    })

    it('survives a reconcile crash', async () => {
      const h = harness(
        [row({ status: 'verified', verifiedAt: NOW, expiresAt: null })],
        { get: vi.fn(async () => receiving) },
        {
          reconcileRoutes: vi.fn(async () => {
            throw new Error('db down')
          }),
        }
      )
      expect(await runSendingDomainPoll(h.deps)).toMatchObject({ processed: 1, failed: 0 })
    })
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

describe('saveSendingDomainPatch: detaching other projects on every verification', () => {
  function fakeDb(updated: { id: string }[]) {
    const updates: Record<string, unknown>[] = []
    const chain = (rows: { id: string }[]) => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return { where: () => ({ returning: async () => rows }) }
      },
    })
    const tx = { update: () => chain(updated) }
    dbMock.update = vi.fn(() => chain(updated))
    dbMock.transaction = vi.fn(async (callback: (t: unknown) => Promise<unknown>) => callback(tx))
    return { tx, updates }
  }

  const target = { id: 'sd-1', projectId: 'project-1', domain: 'acme.com' }

  it('detaches inside the same transaction when a claim becomes verified, and records the metric', async () => {
    const { tx } = fakeDb([{ id: 'sd-1' }])
    const detach = vi.fn(async () => 2)
    const metric = vi.fn(() => true)
    const saved = await saveSendingDomainPatch(
      { ...target, status: 'suspended' },
      { status: 'verified' },
      { policy: () => 'project', detach, metric }
    )
    expect(saved).toBe(true)
    expect(detach).toHaveBeenCalledWith(expect.objectContaining(target), tx)
    expect(metric).toHaveBeenCalledWith('support.sending_domain.address_detached', { domainId: 'sd-1', count: 2 })
  })

  it('does not detach when the guarded update matched no row (an admin moved it meanwhile)', async () => {
    fakeDb([])
    const detach = vi.fn(async () => 1)
    const saved = await saveSendingDomainPatch(
      { ...target, status: 'pending' },
      { status: 'verified' },
      { policy: () => 'project', detach }
    )
    expect(saved).toBe(false)
    expect(detach).not.toHaveBeenCalled()
  })

  it('does not detach for other transitions, an already verified claim, or the legacy policy', async () => {
    fakeDb([{ id: 'sd-1' }])
    const detach = vi.fn(async () => 1)
    await saveSendingDomainPatch(
      { ...target, status: 'verified' },
      { status: 'verified' },
      { policy: () => 'project', detach }
    )
    await saveSendingDomainPatch(
      { ...target, status: 'pending' },
      { status: 'pending' },
      { policy: () => 'project', detach }
    )
    await saveSendingDomainPatch(
      { ...target, status: 'pending' },
      { status: 'verified' },
      { policy: () => 'legacy', detach }
    )
    expect(detach).not.toHaveBeenCalled()
  })

  it('rolls the verification back when the detach fails, so it is retried', async () => {
    fakeDb([{ id: 'sd-1' }])
    const detach = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(
      saveSendingDomainPatch(
        { ...target, status: 'pending' },
        { status: 'verified' },
        { policy: () => 'project', detach }
      )
    ).rejects.toThrow('db down')
  })
})

describe('suspendClaimForSenderRejection', () => {
  it('suspends the verified claim covering the address and records sender_rejected', async () => {
    const { resolveProjectSenderAuthorization } = await import('~/server/utils/sending-domains')
    const { suspendClaimForSenderRejection } = await import('~/server/utils/sending-domain-poller')
    vi.mocked(resolveProjectSenderAuthorization).mockResolvedValueOnce({
      status: 'authorized',
      domain: { id: 'sd-1', domain: 'acme.com' },
    })
    const sets: Record<string, unknown>[] = []
    dbMock.update = vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        sets.push(patch)
        return { where: () => ({ returning: async () => [{ id: 'sd-1', provider: 'mailgun' }] }) }
      },
    }))
    const metric = vi.fn(() => true)
    const suspended = await suspendClaimForSenderRejection(
      'project-1',
      'support@acme.com',
      '553 5.7.1 sender not allowed',
      {
        now: NOW,
        metric,
      }
    )
    expect(suspended).toBe(true)
    expect(sets[0]).toMatchObject({ status: 'suspended', lastErrorCode: 'sender_rejected' })
    expect(sets[0]!.expiresAt).toEqual(new Date(NOW.getTime() + SUSPENDED_TTL_DAYS * 24 * 60 * minutes(1)))
    expect(metric).toHaveBeenCalledWith(
      'support.sending_domain.suspended',
      expect.objectContaining({ domainId: 'sd-1', reason: 'sender_rejected' })
    )
  })

  it('does nothing for an address no verified claim of the project covers', async () => {
    const { resolveProjectSenderAuthorization } = await import('~/server/utils/sending-domains')
    const { suspendClaimForSenderRejection } = await import('~/server/utils/sending-domain-poller')
    vi.mocked(resolveProjectSenderAuthorization).mockResolvedValueOnce({
      status: 'unauthorized',
      reason: 'not_owned',
      projectDomains: [],
    })
    dbMock.update = vi.fn()
    expect(await suspendClaimForSenderRejection('project-1', 'x@other.com', 'refused')).toBe(false)
    expect(dbMock.update).not.toHaveBeenCalled()
  })
})
