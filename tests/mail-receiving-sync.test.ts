import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `syncDomainReceiving` (E3 + setup UX): last_received_at propagation, the MX takeover lookup,
 * the one-time "one more DNS record" notice and the faster cadence while receiving waits.
 * The database is a small fluent fake that records every `set()`.
 */
const state = vi.hoisted(() => ({
  currentRecords: [] as unknown[],
  sets: [] as Record<string, unknown>[],
}))

vi.mock('~/server/database/drizzle', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => [{ dnsRecords: state.currentRecords }],
  }
  return {
    db: {
      select: () => selectChain,
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          state.sets.push(patch)
          return { where: async () => undefined }
        },
      }),
    },
  }
})
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => null) }))
vi.mock('~/server/utils/sending-domains', () => ({
  isSendingDomainsEnabled: vi.fn(() => true),
  resolveSenderPolicy: vi.fn(() => 'project'),
  resolveProjectSenderAuthorization: vi.fn(),
}))

const { syncDomainReceiving, computeReceivingNextCheckAt } = await import('~/server/utils/sending-domain-poller')

const NOW = new Date('2026-10-31T12:00:00Z')
const MINUTE = 60_000
const mxRecord = {
  purpose: 'receiving',
  type: 'MX',
  name: 'acme.com',
  value: 'inbound-smtp.us-east-1.amazonaws.com',
  priority: '10',
  status: 'unknown',
}

function provider(receiving: Record<string, unknown>) {
  const state = {
    status: 'pending_mx',
    forwardingPaused: false,
    records: [mxRecord],
    lastReceivedAt: null,
    ...receiving,
  }
  return {
    name: 'mailgun',
    accountKey: 'acct',
    capabilities: {
      register: true,
      verifyNow: true,
      remove: true,
      inboundRoutes: true,
      authorizesSubdomains: true,
      forwarding: true,
    },
    isConfigured: () => ({ configured: true, missing: [] }),
    getReceiving: vi.fn(async () => state),
    enableReceiving: vi.fn(async () => state),
  } as never
}

const verifiedRow = {
  id: 'd1',
  projectId: 'p1',
  domain: 'acme.com',
  status: 'verified',
  receivingStatus: 'pending_mx',
  verifiedAt: new Date(NOW.getTime() - 10 * MINUTE),
  nextCheckAt: new Date(NOW.getTime() + 24 * 60 * MINUTE),
  mxNoticeSentAt: null,
  lastReceivedAt: null,
  existingMxHosts: null,
}

beforeEach(() => {
  state.currentRecords = [
    { purpose: 'ownership', type: 'TXT', name: '_veerify-mail.acme.com', value: 'x', status: 'valid' },
  ]
  state.sets = []
})

describe('syncDomainReceiving', () => {
  it('stores last_received_at and returns it', async () => {
    const received = new Date('2026-10-31T09:00:00Z')
    const refreshMx = vi.fn(async () => undefined)
    const result = await syncDomainReceiving(
      { ...verifiedRow, receivingStatus: 'active' },
      provider({ status: 'active', lastReceivedAt: received }),
      { now: NOW, refreshMx, notifyMx: vi.fn() }
    )
    expect(result).toMatchObject({ status: 'active', lastReceivedAt: received, skipped: null })
    expect(state.sets[0]).toMatchObject({ receivingStatus: 'active', lastReceivedAt: received })
    // Active: no MX takeover lookup any more.
    expect(refreshMx).not.toHaveBeenCalled()
  })

  it('never clears a stored last_received_at when the provider has none', async () => {
    await syncDomainReceiving(verifiedRow, provider({ lastReceivedAt: null }), {
      now: NOW,
      refreshMx: vi.fn(async () => []),
      notifyMx: vi.fn(),
    })
    expect(state.sets[0]).not.toHaveProperty('lastReceivedAt')
  })

  it('looks up existing MX hosts and emails admins once the MX is the one record left', async () => {
    const refreshMx = vi.fn(async () => ['aspmx.l.google.com'])
    const notifyMx = vi.fn(async () => 2)
    await syncDomainReceiving(verifiedRow, provider({}), { now: NOW, refreshMx, notifyMx })
    expect(refreshMx).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', domain: 'acme.com', receivingStatus: 'pending_mx' }),
      { now: NOW }
    )
    expect(notifyMx).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'd1',
        projectId: 'p1',
        existingMxHosts: ['aspmx.l.google.com'],
        dnsRecords: expect.arrayContaining([expect.objectContaining({ type: 'MX' })]),
      }),
      { now: NOW }
    )
  })

  it('does not notify again once the notice was sent, nor before the claim is verified', async () => {
    const notifyMx = vi.fn(async () => 0)
    const refreshMx = vi.fn(async () => [])
    await syncDomainReceiving({ ...verifiedRow, mxNoticeSentAt: NOW }, provider({}), { now: NOW, refreshMx, notifyMx })
    await syncDomainReceiving({ ...verifiedRow, status: 'pending' }, provider({}), { now: NOW, refreshMx, notifyMx })
    await syncDomainReceiving(verifiedRow, provider({ status: 'pending_verification' }), {
      now: NOW,
      refreshMx,
      notifyMx,
    })
    expect(notifyMx).not.toHaveBeenCalled()
  })

  it('checks a verified claim that waits for receiving sooner than the daily cadence', async () => {
    await syncDomainReceiving(verifiedRow, provider({}), { now: NOW, refreshMx: vi.fn(), notifyMx: vi.fn() })
    expect(state.sets[0]!.nextCheckAt).toEqual(new Date(NOW.getTime() + 5 * MINUTE))
  })

  it('leaves the cadence alone for active receiving and for pending claims', async () => {
    await syncDomainReceiving({ ...verifiedRow, receivingStatus: 'active' }, provider({ status: 'active' }), {
      now: NOW,
      refreshMx: vi.fn(),
      notifyMx: vi.fn(),
    })
    await syncDomainReceiving({ ...verifiedRow, status: 'pending' }, provider({}), {
      now: NOW,
      refreshMx: vi.fn(),
      notifyMx: vi.fn(),
    })
    expect(state.sets.every((patch) => !('nextCheckAt' in patch))).toBe(true)
  })
})

describe('computeReceivingNextCheckAt', () => {
  const at = (ageMs: number) =>
    computeReceivingNextCheckAt(new Date(NOW.getTime() - ageMs), NOW).getTime() - NOW.getTime()
  it('backs off from 5 minutes to daily over a week', () => {
    expect(at(10 * MINUTE)).toBe(5 * MINUTE)
    expect(at(2 * 60 * MINUTE)).toBe(15 * MINUTE)
    expect(at(2 * 24 * 60 * MINUTE)).toBe(60 * MINUTE)
    expect(at(8 * 24 * 60 * MINUTE)).toBe(24 * 60 * MINUTE)
  })
})
