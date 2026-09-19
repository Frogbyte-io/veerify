import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => (name === 'id' ? 'conversation-1' : undefined))
const timelineLimitCalls = vi.hoisted(() => [] as number[])

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))
vi.mock('~/server/utils/support-access', () => ({
  requireTeamMembership: vi.fn(async () => undefined),
  requireConversationAccess: vi.fn(async () => ({ teamId: 'team-1', inboxId: 'inbox-1' })),
  requireContactAccess: vi.fn(async () => ({ id: 'contact-1', teamId: 'team-1', email: 'contact@example.com' })),
}))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/support-errors', () => ({ isUniqueViolation: vi.fn(() => false) }))
vi.mock('~/server/database/drizzle', () => {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: (value: number) => {
      timelineLimitCalls.push(value)
      return Promise.resolve([])
    },
  }
  const insertChain = {
    values: () => insertChain,
    returning: () => Promise.resolve([{ id: 'participant-1' }]),
  }
  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
    },
  }
})

type Handler = EventHandler

const contactsHandler = (await import('~/server/api/support/contacts/index.get')).default as Handler
const companiesHandler = (await import('~/server/api/support/companies/index.get')).default as Handler
const participantsHandler = (await import('~/server/api/support/conversations/[id]/participants/index.post'))
  .default as Handler
const timelineHandler = (await import('~/server/api/support/contacts/[id]/timeline.get')).default as Handler

function asEvent(value: unknown): Parameters<Handler>[0] {
  return value as Parameters<Handler>[0]
}

beforeEach(() => {
  vi.stubGlobal('createError', (input: Record<string, unknown>) =>
    Object.assign(new Error(String(input.statusMessage)), input)
  )
})

describe('support list query validation', () => {
  it('returns the standardized 400 response for an invalid contacts limit', async () => {
    vi.stubGlobal('getQuery', () => ({ teamId: 'team-1', limit: 'not-a-number' }))

    await expect(contactsHandler(asEvent({}))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter validation failed',
        },
      },
    })
  })

  it('returns the standardized 400 response for an invalid companies limit', async () => {
    vi.stubGlobal('getQuery', () => ({ teamId: 'team-1', limit: 'not-a-number' }))

    await expect(companiesHandler(asEvent({}))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter validation failed',
        },
      },
    })
  })
})

describe('conversation participant validation', () => {
  it('rejects a contact participant unless its role is cc', async () => {
    vi.stubGlobal('readBody', async () => ({ contactId: 'contact-1', role: 'follower' }))

    await expect(participantsHandler(asEvent({ params: { id: 'conversation-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
        },
      },
    })
  })

  it('rejects a user participant unless its role is follower', async () => {
    vi.stubGlobal('readBody', async () => ({ userId: 'user-2', role: 'cc' }))

    await expect(participantsHandler(asEvent({ params: { id: 'conversation-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
        },
      },
    })
  })

  it('rejects a participant with neither an identifier', async () => {
    vi.stubGlobal('readBody', async () => ({ role: 'cc' }))

    await expect(participantsHandler(asEvent({ params: { id: 'conversation-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
        },
      },
    })
  })

  it('rejects a participant with both identifiers', async () => {
    vi.stubGlobal('readBody', async () => ({ contactId: 'contact-1', userId: 'user-2', role: 'cc' }))

    await expect(participantsHandler(asEvent({ params: { id: 'conversation-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
        },
      },
    })
  })
})

describe('contact timeline query validation', () => {
  beforeEach(() => {
    timelineLimitCalls.length = 0
  })

  it('uses the default limit when omitted', async () => {
    vi.stubGlobal('getQuery', () => ({}))

    const response = await timelineHandler(asEvent({}))

    expect(response).toMatchObject({ success: true, data: { linked: [], probableFeedback: [] } })
    expect(timelineLimitCalls).toEqual([26, 26])
  })

  it('accepts the maximum limit', async () => {
    vi.stubGlobal('getQuery', () => ({ limit: '100' }))

    await expect(timelineHandler(asEvent({}))).resolves.toMatchObject({ success: true })
    expect(timelineLimitCalls).toEqual([101, 101])
  })

  it.each(['0', '101'])('rejects limit %s with a standardized 400 response', async (limit) => {
    vi.stubGlobal('getQuery', () => ({ limit }))

    await expect(timelineHandler(asEvent({}))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      data: { success: false, error: { code: 'VALIDATION_ERROR' } },
    })
  })

  it('queries only the requested linked section', async () => {
    vi.stubGlobal('getQuery', () => ({ section: 'linked' }))

    const response = await timelineHandler(asEvent({}))

    expect(response).toMatchObject({ success: true, data: { linked: [], probableFeedback: [] } })
    expect(timelineLimitCalls).toEqual([26])
  })

  it('queries only the requested probable section', async () => {
    vi.stubGlobal('getQuery', () => ({ section: 'probable' }))

    const response = await timelineHandler(asEvent({}))

    expect(response).toMatchObject({ success: true, data: { linked: [], probableFeedback: [] } })
    expect(timelineLimitCalls).toEqual([26])
  })

  it('rejects an invalid section with 400', async () => {
    vi.stubGlobal('getQuery', () => ({ section: 'everything' }))

    await expect(timelineHandler(asEvent({}))).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each([
    ['malformed', 'not-a-cursor'],
    [
      'wrong version',
      Buffer.from(JSON.stringify({ v: 0, createdAt: '2026-08-13T12:00:00.000Z', id: 'row-a' })).toString('base64url'),
    ],
  ])('rejects a %s cursor with 400', async (_label, cursor) => {
    vi.stubGlobal('getQuery', () => ({ linkedCursor: cursor }))

    await expect(timelineHandler(asEvent({}))).rejects.toMatchObject({ statusCode: 400 })
  })
})
