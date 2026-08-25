import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => (name === 'id' ? 'conversation-1' : undefined))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))
vi.mock('~/server/utils/support-access', () => ({
  requireTeamMembership: vi.fn(async () => undefined),
  requireConversationAccess: vi.fn(async () => ({ teamId: 'team-1', inboxId: 'inbox-1' })),
}))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/support-errors', () => ({ isUniqueViolation: vi.fn(() => false) }))
vi.mock('~/server/database/drizzle', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([{ id: 'contact-1' }]),
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
