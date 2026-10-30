import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MailgunChannelDriver } from '../server/services/support-channels/webhook/mailgun'

const state = vi.hoisted(() => ({
  body: '' as string,
  touch: vi.fn(async () => undefined),
  claim: vi.fn(),
  resolve: vi.fn(),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('h3', () => ({
  getHeaders: () => ({}),
  getRouterParam: () => 'mailgun',
  readRawBody: async () => state.body,
  createError: (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input),
}))
vi.mock('~/server/services/support-channels', () => {
  const driver = new MailgunChannelDriver({ signingKey: 'k', accountKey: 'a' })
  driver.verifySignature = () => true
  return { getChannelDriver: () => driver }
})
vi.mock('~/server/utils/rate-limit', () => ({ checkRateLimit: async () => true }))
vi.mock('~/server/utils/frogmail-destination-events', () => ({ touchForwardDestination: state.touch }))
vi.mock('~/server/utils/delivery-events', () => ({
  applyDeliveryEventStatus: vi.fn(),
  claimDeliveryEvent: state.claim,
  completeDeliveryEvent: vi.fn(),
  failDeliveryEvent: vi.fn(),
}))
vi.mock('~/server/utils/outbound-delivery', () => ({
  publishDeliveryStatusChanged: vi.fn(),
  recordProviderChannelMessageId: vi.fn(),
  resolveDeliveryCorrelation: state.resolve,
}))
vi.mock('~/server/utils/support-observability', () => ({ recordSupportMetric: vi.fn() }))
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const route = (await import('../server/api/support/delivery/[provider].post')).default as (
  event: unknown
) => Promise<{ data?: { reason?: string } }>

const variables = { 'frogmail-forward-destination-id': 'fd_1' }

describe('support delivery webhook: Frogmail forward events', () => {
  beforeEach(() => {
    state.touch.mockClear()
    state.claim.mockReset()
    state.resolve.mockReset()
  })

  it.each([{ event: 'delivered' }, { event: 'failed', severity: 'permanent' }, { event: 'complained' }])(
    'acknowledges a tagged $event event, stamps the destination and records nothing else',
    async (data) => {
      state.body = JSON.stringify({
        'event-data': {
          id: 'ev_1',
          recipient: 'owner@example.org',
          tags: ['frogmail-forward'],
          'user-variables': variables,
          ...data,
        },
      })
      const response = await route({})
      expect(JSON.stringify(response)).toContain('forward-event')
      expect(state.touch).toHaveBeenCalledWith('fd_1', expect.any(Date))
      expect(state.resolve).not.toHaveBeenCalled()
      expect(state.claim).not.toHaveBeenCalled()
    }
  )

  it('acknowledges a tagged event without a destination id and without an event id', async () => {
    state.body = JSON.stringify({ 'event-data': { event: 'delivered', tags: ['frogmail-forward'] } })
    const response = await route({})
    expect(JSON.stringify(response)).toContain('forward-event')
    expect(state.touch).not.toHaveBeenCalled()
    expect(state.claim).not.toHaveBeenCalled()
  })

  it('still handles untagged events as support deliveries', async () => {
    state.resolve.mockResolvedValue(null)
    state.claim.mockResolvedValue({ outcome: 'duplicate' })
    state.body = JSON.stringify({
      'event-data': { id: 'ev_2', event: 'delivered', recipient: 'a@b.test', tags: ['x'] },
    })
    const response = await route({})
    expect(JSON.stringify(response)).toContain('duplicate-event')
    expect(state.touch).not.toHaveBeenCalled()
    expect(state.claim).toHaveBeenCalled()
  })
})
