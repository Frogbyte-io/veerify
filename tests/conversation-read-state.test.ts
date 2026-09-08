import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

const state = vi.hoisted(() => ({
  query: { inboxId: 'inbox-1' } as Record<string, unknown>,
  queuedRows: [] as unknown[][],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getQuery', () => state.query)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'agent-b' } })),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireInboxAccess: vi.fn(async () => ({ id: 'inbox-1', teamId: 'team-1' })),
}))

vi.mock('~/server/database/drizzle', () => {
  const chain = (rows: unknown[]) => {
    const result = Promise.resolve(rows)
    const fluent: Record<string, unknown> = {
      from: () => fluent,
      leftJoin: () => fluent,
      where: () => fluent,
      orderBy: () => fluent,
      limit: () => result,
      then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    }
    return fluent
  }

  return {
    db: {
      select: () => chain(state.queuedRows.shift() ?? []),
    },
  }
})

const listHandler = (await import('~/server/api/support/conversations/index.get')).default as EventHandler
const { setConversationReadStateInTransaction } = await import('~/server/utils/conversation-read-state')

function asEvent(value: unknown): Parameters<EventHandler>[0] {
  return value as Parameters<EventHandler>[0]
}

function txWithLockedConversations(rows: unknown[]) {
  const query = {
    from: () => query,
    where: () => query,
    for: () => Promise.resolve(rows),
  }
  return {
    select: () => query,
  } as unknown as Parameters<typeof setConversationReadStateInTransaction>[0]
}

describe('conversation read state list contract', () => {
  beforeEach(() => {
    state.query = { inboxId: 'inbox-1' }
    state.queuedRows = []
  })

  it('derives unread per user while handled conversations disappear from other agents queues', async () => {
    const createdAt = new Date('2026-09-07T08:00:00.000Z')
    const incomingAt = new Date('2026-09-07T09:00:00.000Z')
    const replyAt = new Date('2026-09-07T09:30:00.000Z')

    state.queuedRows.push(
      [
        {
          id: 'unclaimed',
          inboxId: 'inbox-1',
          assigneeUserId: null,
          createdAt,
          lastCustomerReplyAt: incomingAt,
          lastAgentReplyAt: null,
          lastReadAt: null,
        },
        {
          id: 'handled-by-a',
          inboxId: 'inbox-1',
          assigneeUserId: 'agent-a',
          createdAt,
          lastCustomerReplyAt: incomingAt,
          lastAgentReplyAt: replyAt,
          lastReadAt: null,
        },
        {
          id: 'assigned-to-b',
          inboxId: 'inbox-1',
          assigneeUserId: 'agent-b',
          createdAt,
          lastCustomerReplyAt: incomingAt,
          lastAgentReplyAt: replyAt,
          lastReadAt: new Date('2026-09-07T08:30:00.000Z'),
        },
        {
          id: 'read-by-b',
          inboxId: 'inbox-1',
          assigneeUserId: 'agent-b',
          createdAt,
          lastCustomerReplyAt: incomingAt,
          lastAgentReplyAt: replyAt,
          lastReadAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
      [{ unassigned: 1, assignedToMe: 1 }]
    )

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        conversations: [
          { id: 'unclaimed', isUnread: true },
          { id: 'handled-by-a', isUnread: false },
          { id: 'assigned-to-b', isUnread: true },
          { id: 'read-by-b', isUnread: false },
        ],
        unreadCounts: { unassigned: 1, assignedToMe: 1 },
      },
    })
  })
})

describe('setConversationReadStateInTransaction', () => {
  it('reports a missing locked conversation as a standardized 404', async () => {
    await expect(
      setConversationReadStateInTransaction(txWithLockedConversations([]), 'conversation-missing', 'agent-b', false)
    ).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Conversation not found',
        },
      },
    })
  })
})
