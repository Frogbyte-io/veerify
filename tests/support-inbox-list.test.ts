import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

const authState = vi.hoisted(() => ({ userId: 'agent-1' }))
const queued: unknown[][] = []

function queueResult(rows: unknown[]) {
  queued.push(rows)
}

function nextResult() {
  return queued.shift() ?? []
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getQuery', () => ({ teamId: 'team-1' }))
vi.stubGlobal('getRouterParam', () => 'inbox-2')

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: authState.userId } })),
}))

vi.mock('~/server/database/drizzle', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(nextResult()),
      limit: () => Promise.resolve(nextResult()),
    }
    return chain
  }

  return { db: { select: () => makeChain() } }
})

const listHandler = (await import('~/server/api/support/inboxes/index.get')).default as EventHandler
const detailHandler = (await import('~/server/api/support/inboxes/[id].get')).default as EventHandler

function asEvent(value: unknown): Parameters<EventHandler>[0] {
  return value as Parameters<EventHandler>[0]
}

beforeEach(() => {
  queued.length = 0
  vi.stubGlobal('createError', (input: Record<string, unknown>) =>
    Object.assign(new Error(String(input.statusMessage)), input)
  )
})

describe('support inbox list authorization', () => {
  it('returns only assigned inboxes with agent capabilities', async () => {
    authState.userId = 'agent-1'
    queueResult([{ id: 'team-member-1', role: 'member' }])
    queueResult([
      {
        id: 'inbox-1',
        teamId: 'team-1',
        name: 'Assigned inbox',
        role: 'agent',
      },
    ])

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        inboxes: [
          {
            id: 'inbox-1',
            name: 'Assigned inbox',
            effectiveRole: 'agent',
            isTeamAdmin: false,
            capabilities: {
              canWorkConversations: true,
              canManageTagVocabulary: false,
              canManageMembers: false,
              canManageInbox: false,
              canManageTeamSupport: false,
            },
          },
        ],
      },
    })
    expect(result.data.inboxes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'inbox-2' })]))
  })

  it('returns every team inbox with effective admin capabilities for team admins', async () => {
    authState.userId = 'admin-1'
    queueResult([{ id: 'team-admin-1', role: 'admin' }])
    queueResult([
      { id: 'inbox-1', teamId: 'team-1', name: 'First inbox' },
      { id: 'inbox-2', teamId: 'team-1', name: 'Second inbox' },
    ])

    const result = await listHandler(asEvent({}))

    expect(result.data.inboxes).toHaveLength(2)
    expect(result.data.inboxes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inbox-2',
          effectiveRole: 'admin',
          isTeamAdmin: true,
          capabilities: expect.objectContaining({
            canManageInbox: true,
            canManageTeamSupport: true,
          }),
        }),
      ])
    )
  })

  it('returns an empty list for an unassigned team member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'team-member-2', role: 'member' }])
    queueResult([])

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({ success: true, data: { inboxes: [] } })
  })
})

describe('support inbox detail authorization', () => {
  it('does not disclose inaccessible inbox metadata to an unassigned member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'inbox-2', teamId: 'team-1', name: 'Private inbox' }])
    queueResult([])
    queueResult([])

    await expect(detailHandler(asEvent({}))).rejects.toMatchObject({
      statusCode: 403,
      data: {
        error: {
          message: 'You do not have access to this support inbox',
        },
      },
    })
  })
})
