import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.stubGlobal('setResponseStatus', vi.fn())

const claim = { outcome: 'claimed' as const, eventId: 'event-1', attemptCount: 1 }
const attachInboundEventInbox = vi.fn(async () => false)
const rejectInboundEvent = vi.fn(async () => false)
const failInboundEvent = vi.fn(async () => true)
const checkRateLimit = vi.fn(async () => true)

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getHeaders: () => ({ authorization: 'Basic valid' }),
  getRouterParam: () => 'postmark',
  readRawBody: async () => JSON.stringify({ MessageID: 'provider-1' }),
  setResponseStatus: vi.fn(),
}))
vi.mock('~/server/services/support-channels', () => ({
  emailDomain: () => 'example.com',
  getChannelDriver: () => ({
    name: 'postmark',
    verifySignature: () => true,
    extractEventId: () => 'provider-1',
    parse: () => ({
      messageId: 'message-1',
      inReplyTo: null,
      references: [],
      from: { address: 'customer@example.com', name: null },
      to: [{ address: 'support@example.com', name: null }],
      cc: [],
      subject: 'Subject',
      text: 'Body',
      html: '<p>Body</p>',
      rawHeaders: {},
      attachments: [],
      receivedAt: new Date(),
    }),
  }),
}))
vi.mock('~/server/utils/inbound-events', () => ({
  attachInboundEventInbox,
  claimInboundEvent: vi.fn(async () => claim),
  completeInboundEvent: vi.fn(async () => true),
  failInboundEvent,
  recordInboundRawKey: vi.fn(async () => true),
  rejectInboundEvent,
}))
vi.mock('~/server/utils/support-access', () => ({
  resolveInboxByAddress: vi.fn(async () => ({
    inbox: {
      id: 'inbox-1',
      teamId: 'team-1',
      isEnabled: true,
      autoReplyEnabled: false,
      autoReplyTemplate: null,
      emailAddress: null,
      fromName: null,
      signature: null,
      projectId: 'legacy-project',
    },
    address: { projectId: null },
  })),
}))
vi.mock('~/server/utils/storage', () => ({ getStorageProvider: () => ({ putObject: vi.fn(async () => undefined) }) }))
vi.mock('~/server/utils/rate-limit', () => ({ checkRateLimit }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }))
vi.mock('~/server/utils/response', () => ({ createSuccessResponse: (data: unknown) => ({ success: true, data }) }))
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

vi.mock('~/server/utils/support-counter', () => ({ allocateConversationDisplayId: vi.fn() }))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: vi.fn() }))
vi.mock('~/server/utils/inbound-threading', () => ({ resolveThread: vi.fn() }))
vi.mock('~/server/utils/inbound-content', () => ({ stripQuotedReply: vi.fn() }))
vi.mock('~/server/utils/inbound-sanitize', () => ({ sanitizeInboundHtml: vi.fn() }))
vi.mock('~/server/utils/inbound-autoresponse', () => ({ isAutoResponse: () => false }))
vi.mock('~/server/utils/inbound-contacts', () => ({ resolveCcParticipants: vi.fn(), resolveOrCreateContact: vi.fn() }))
vi.mock('~/server/utils/inbound-attachments', () => ({
  ingestInboundAttachments: vi.fn(),
  rewriteInlineCidReferences: vi.fn(),
}))
vi.mock('~/server/services/rate-limit', () => ({ getRateLimitStore: () => ({ consume: vi.fn(async () => true) }) }))
vi.mock('~/server/utils/auto-reply', () => ({
  AUTO_REPLY_RATE_LIMIT_MAX: 1,
  AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS: 60,
  buildAutoReply: vi.fn(),
  shouldSendAutoReply: () => false,
}))
vi.mock('~/server/utils/outbound-delivery', () => ({
  enqueueOutboundDelivery: vi.fn(),
  runOutboundDeliveryWorker: vi.fn(),
}))

type Handler = EventHandler

const handler = (await import('../server/api/support/inbound/[provider].post')).default as Handler

describe('inbound route claim-loss control', () => {
  beforeEach(() => {
    attachInboundEventInbox.mockClear()
    rejectInboundEvent.mockClear()
    failInboundEvent.mockClear()
    checkRateLimit.mockClear()
    checkRateLimit.mockResolvedValue(true)
  })

  it('applies a high-capacity provider-IP edge bucket before reading the body', async () => {
    checkRateLimit.mockResolvedValueOnce(false)

    await expect(handler({} as Parameters<Handler>[0])).rejects.toMatchObject({ statusCode: 429 })
    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ identifier: 'support-inbound-edge', maxRequests: 5_000, windowSeconds: 60 })
    )
  })

  it('returns retryable 500 when attaching the inbox loses ownership', async () => {
    await expect(handler({} as Parameters<Handler>[0])).rejects.toMatchObject({ statusCode: 500 })
    expect(failInboundEvent).toHaveBeenCalledWith(
      { eventId: claim.eventId, attemptCount: claim.attemptCount },
      expect.any(Error)
    )
  })

  it('returns retryable 500 when deliberate rejection loses ownership', async () => {
    attachInboundEventInbox.mockResolvedValueOnce(true)
    const db = await import('../server/database/drizzle')
    ;(db.db as unknown as { select: ReturnType<typeof vi.fn> }).select = vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => [{ supportEnabled: false }] }) }),
    }))

    await expect(handler({} as Parameters<Handler>[0])).rejects.toMatchObject({ statusCode: 500 })
    expect(rejectInboundEvent).toHaveBeenCalledWith(
      { eventId: claim.eventId, attemptCount: claim.attemptCount },
      'Support is disabled for this team'
    )
    expect(failInboundEvent).toHaveBeenCalledWith(
      { eventId: claim.eventId, attemptCount: claim.attemptCount },
      expect.any(Error)
    )
  })
})
