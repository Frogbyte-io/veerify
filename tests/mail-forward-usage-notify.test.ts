import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Forward limit pause/resume: the admins hear about each change once. */
const state = vi.hoisted(() => ({
  domains: [] as Array<{ id: string; domain: string; forwardingPausedAt: Date | null; projectId: string }>,
  forwarded: 0,
  /** Rows a guarded update "changes"; empty simulates a concurrent pass that already did it. */
  changed: true,
  sets: [] as Record<string, unknown>[],
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        state.sets.push(patch)
        return {
          where: () => ({
            returning: async () =>
              state.changed ? [{ projectId: state.domains[state.sets.length - 1]!.projectId }] : [],
          }),
        }
      },
    }),
  },
}))
vi.mock('~/server/utils/mail-forward-count', () => ({
  listReceivingDomains: vi.fn(async () => state.domains),
  fetchForwardCount: vi.fn(async () => state.forwarded),
  setCachedForwardCount: vi.fn(),
}))
vi.mock('~/server/utils/mail-limits', () => ({ getMailTier: vi.fn(async () => 'standard') }))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: vi.fn(() => null) }))
vi.mock('~/server/utils/mail-setup-notifications', () => ({ notifyForwardingChange: vi.fn() }))

const { enforceForwardLimit } = await import('~/server/utils/mail-forward-usage')

const NOW = new Date('2026-10-31T12:00:00Z')
const provider = { setForwardingPaused: vi.fn(async () => ({})) } as never

beforeEach(() => {
  state.sets = []
  state.changed = true
  state.domains = [
    { id: 'd1', domain: 'a.com', forwardingPausedAt: null, projectId: 'p1' },
    { id: 'd2', domain: 'b.com', forwardingPausedAt: null, projectId: 'p2' },
  ]
})

describe('enforceForwardLimit notifications', () => {
  it('notifies the projects whose domains it paused, with the limit', async () => {
    state.forwarded = 5000
    const notify = vi.fn(async () => 2)
    expect(await enforceForwardLimit(provider, 'org-1', NOW, { notify })).toMatchObject({ paused: 2, resumed: 0 })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('paused', ['p1', 'p2'], { forwardsPerMonth: 5000 })
  })

  it('notifies on resume in a new month', async () => {
    state.forwarded = 10
    state.domains = state.domains.map((row) => ({ ...row, forwardingPausedAt: NOW }))
    const notify = vi.fn(async () => 2)
    await enforceForwardLimit(provider, 'org-1', NOW, { notify })
    expect(notify).toHaveBeenCalledWith('resumed', ['p1', 'p2'], { forwardsPerMonth: 5000 })
  })

  it('sends nothing when a concurrent pass already changed the domains', async () => {
    state.forwarded = 5000
    state.changed = false
    const notify = vi.fn(async () => 0)
    await enforceForwardLimit(provider, 'org-1', NOW, { notify })
    expect(notify).not.toHaveBeenCalled()
  })

  it('sends nothing on a pass that changes nothing (already paused, still over)', async () => {
    state.forwarded = 6000
    state.domains = state.domains.map((row) => ({ ...row, forwardingPausedAt: NOW }))
    const notify = vi.fn(async () => 0)
    expect(await enforceForwardLimit(provider, 'org-1', NOW, { notify })).toMatchObject({ paused: 0, resumed: 0 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify below 100 %, even at the 80 % warning level', async () => {
    state.forwarded = 4500
    const notify = vi.fn(async () => 0)
    await enforceForwardLimit(provider, 'org-1', NOW, { notify })
    expect(notify).not.toHaveBeenCalled()
  })
})
