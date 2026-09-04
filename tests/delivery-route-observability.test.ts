import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

/**
 * Route-level proof that `support.delivery.uncorrelated` actually fires, and
 * carries nothing it should not.
 *
 * This is the one support metric that is an alert rather than a statistic: a
 * steady nonzero rate means the correlation contract has drifted from what a
 * provider really sends, and delivery status silently stops updating. Everything
 * else in `tests/delivery-route-control.test.ts` covers the pure selector, which
 * cannot show whether the route counts its own result.
 *
 * `support-observability` is deliberately NOT mocked. The logger underneath it
 * is, so the real validation runs and the emitted record is asserted.
 */

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
const state = vi.hoisted(() => ({ correlated: null as { id: string; conversationId: string } | null }))

type TransactionCallback = (tx: unknown) => unknown

const deliveryEvent = {
  provider: 'postmark',
  providerAccountKey: 'server-a',
  providerEventId: 'provider-event-1',
  providerMessageId: 'provider-message-1',
  correlationKey: null,
  recordType: 'delivered' as const,
  // Present on the parsed event and deliberately never forwarded to a metric.
  recipient: 'customer@example.com',
  occurredAt: new Date('2026-09-03T00:00:00.000Z'),
  bounceType: null,
  bounceDetail: null,
}

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getHeaders: () => ({ authorization: 'Basic valid' }),
  getRouterParam: () => 'postmark',
  readRawBody: async () => JSON.stringify({ RecordType: 'Delivery' }),
}))
vi.mock('~/server/services/support-channels', () => ({
  getChannelDriver: () => ({
    name: 'postmark',
    verifySignature: () => true,
    parseDeliveryEvent: () => deliveryEvent,
  }),
}))
vi.mock('~/server/utils/delivery-events', () => ({
  applyDeliveryEventStatus: vi.fn(async () => true),
  claimDeliveryEvent: vi.fn(async () => ({ outcome: 'claimed', eventId: 'event-1', attemptCount: 1 })),
  completeDeliveryEvent: vi.fn(async () => true),
  failDeliveryEvent: vi.fn(async () => true),
}))
vi.mock('~/server/utils/outbound-delivery', () => ({
  publishDeliveryStatusChanged: vi.fn(async () => undefined),
  resolveDeliveryCorrelation: vi.fn(async () => state.correlated),
}))
vi.mock('~/server/utils/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }))
vi.mock('~/server/utils/response', () => ({ createSuccessResponse: (data: unknown) => ({ success: true, data }) }))
vi.mock('~/server/database/drizzle', () => ({
  db: { transaction: async (run: TransactionCallback) => run({}) },
}))
vi.mock('~/server/utils/logger', () => ({
  createLogger: () => logs,
  logger: logs,
}))

const handler = (await import('../server/api/support/delivery/[provider].post')).default as EventHandler

function metricCalls(name: string) {
  return logs.info.mock.calls.filter((call) => call[0] === name)
}

describe('delivery route observability', () => {
  beforeEach(() => {
    logs.info.mockClear()
    logs.warn.mockClear()
    state.correlated = null
  })

  it('counts a signature-valid event that correlates to nothing', async () => {
    const response = await handler({} as never)

    expect(response).toEqual({ success: true, data: { accepted: true, reason: 'unmatched-message' } })
    expect(metricCalls('support.delivery.uncorrelated')).toEqual([
      [
        'support.delivery.uncorrelated',
        {
          metric: 'support.delivery.uncorrelated',
          provider: 'postmark',
          providerAccountKey: 'server-a',
          providerMessageId: 'provider-message-1',
          recordType: 'delivered',
          eventId: 'event-1',
        },
      ],
    ])
  })

  it('does not forward the recipient address into the metric', async () => {
    await handler({} as never)

    // The address is on the parsed event and in scope at the call site, so this
    // is a real mistake to guard against, not a hypothetical one.
    expect(JSON.stringify(metricCalls('support.delivery.uncorrelated'))).not.toContain('customer@example.com')
  })

  it('emits a valid record, so the metric is counted rather than rejected', async () => {
    await handler({} as never)

    // A rejected record warns and emits nothing. Asserting the absence of that
    // warning is what proves the call site matches the field allowlist.
    expect(logs.warn).not.toHaveBeenCalledWith('Rejected an invalid support metric', expect.anything())
  })

  it('does not count an event that correlates successfully', async () => {
    state.correlated = { id: 'message-1', conversationId: 'conversation-1' }

    const response = await handler({} as never)

    expect(response).toEqual({ success: true, data: { accepted: true, reason: 'processed' } })
    expect(metricCalls('support.delivery.uncorrelated')).toEqual([])
  })
})
