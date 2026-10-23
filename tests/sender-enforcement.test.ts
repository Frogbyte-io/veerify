import { beforeEach, describe, expect, it, vi } from 'vitest'

// WP1 (sending-domains utils) and WP2 (provider) are mocked: this suite is about
// how the shared enforcement helper uses them, not about their own logic.
const sendingDomains = vi.hoisted(() => ({
  resolveSenderPolicy: vi.fn<() => 'legacy' | 'project'>(() => 'legacy'),
  resolveEffectiveSenderPolicy: vi.fn(async (): Promise<'legacy' | 'project'> => 'legacy'),
  isDomainClaimedByOtherProject: vi.fn(async () => false),
  resolveProjectSenderAuthorization: vi.fn(),
}))
sendingDomains.resolveEffectiveSenderPolicy.mockImplementation(async () => sendingDomains.resolveSenderPolicy())
const provider = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const metrics = vi.hoisted(() => ({ recordSupportMetric: vi.fn() }))

vi.mock('~/server/utils/sending-domains', () => sendingDomains)
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))
vi.mock('~/server/utils/support-observability', () => metrics)

const { evaluateProjectSender, isSenderAllowedForProject, isSenderAllowedOrRecordBlock } =
  await import('../server/utils/sender-enforcement')

beforeEach(() => {
  vi.clearAllMocks()
  sendingDomains.resolveSenderPolicy.mockReturnValue('legacy')
  provider.current = null
})

describe('legacy sender policy', () => {
  it('is not enforced: no verdict, no lookup, always allowed', async () => {
    expect(await evaluateProjectSender('project-1', 'support@acme.com')).toBeNull()
    expect(await isSenderAllowedForProject('project-1', 'support@acme.com')).toBe(true)
    expect(await isSenderAllowedOrRecordBlock('project-1', 'support@acme.com', 'csat')).toBe(true)

    expect(sendingDomains.resolveProjectSenderAuthorization).not.toHaveBeenCalled()
    expect(metrics.recordSupportMetric).not.toHaveBeenCalled()
  })
})

describe('project sender policy', () => {
  beforeEach(() => sendingDomains.resolveSenderPolicy.mockReturnValue('project'))

  it('passes the provider identity and subdomain capability to the verdict lookup', async () => {
    provider.current = {
      name: 'mailgun',
      accountKey: 'acct',
      capabilities: { authorizesSubdomains: true },
    }
    sendingDomains.resolveProjectSenderAuthorization.mockResolvedValue({
      status: 'authorized',
      domain: { id: 'd1', domain: 'acme.com' },
    })

    await evaluateProjectSender('project-1', 'support@acme.com')

    expect(sendingDomains.resolveProjectSenderAuthorization).toHaveBeenCalledWith('project-1', 'support@acme.com', {
      provider: { name: 'mailgun', accountKey: 'acct', authorizesSubdomains: true },
    })
  })

  it('leaves provider options to the lookup when no sending-domain provider exists', async () => {
    sendingDomains.resolveProjectSenderAuthorization.mockResolvedValue({ status: 'unknown', reason: 'x' })

    await evaluateProjectSender('project-1', 'support@acme.com')

    expect(sendingDomains.resolveProjectSenderAuthorization).toHaveBeenCalledWith('project-1', 'support@acme.com', {})
  })

  it.each([
    [{ status: 'authorized', domain: null, platform: true }, true],
    [{ status: 'pending', domain: { id: 'd1', domain: 'acme.com', status: 'pending' } }, false],
    [{ status: 'unauthorized', reason: 'not_owned', projectDomains: [] }, false],
    // Unknown must never authorize a send; it is only "not shown as a failure" in settings.
    [{ status: 'unknown', reason: 'unreadable' }, false],
  ])('treats %j as allowed=%s', async (verdict, allowed) => {
    sendingDomains.resolveProjectSenderAuthorization.mockResolvedValue(verdict)

    expect(await isSenderAllowedForProject('project-1', 'support@acme.com')).toBe(allowed)
  })

  it('records a blocked metric with the caller reason when a background path is refused', async () => {
    sendingDomains.resolveProjectSenderAuthorization.mockResolvedValue({
      status: 'unauthorized',
      reason: 'not_owned',
      projectDomains: [],
    })

    expect(await isSenderAllowedOrRecordBlock('project-1', 'support@acme.com', 'auto_reply')).toBe(false)
    expect(metrics.recordSupportMetric).toHaveBeenCalledWith('support.sending_domain.blocked', {
      reason: 'auto_reply',
    })
  })

  it('records nothing when the sender is allowed', async () => {
    sendingDomains.resolveProjectSenderAuthorization.mockResolvedValue({ status: 'authorized', domain: null })

    expect(await isSenderAllowedOrRecordBlock('project-1', 'support@acme.com', 'csat')).toBe(true)
    expect(metrics.recordSupportMetric).not.toHaveBeenCalled()
  })
})
