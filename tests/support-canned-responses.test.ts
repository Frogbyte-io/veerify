import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { id: 'response-1' } as Record<string, string>,
  query: { teamId: 'team-1' } as Record<string, unknown>,
  queuedRows: [] as unknown[][],
  insertedValues: null as Record<string, unknown> | null,
  updatedSet: null as Record<string, unknown> | null,
  deleteCalled: false,
  session: { user: { id: 'user-1', name: 'Agent One' } },
}))

const access = vi.hoisted(() => ({
  requireTeamMembership: vi.fn(async () => ({ id: 'member-1', role: 'member' })),
  requireSupportTeamRole: vi.fn(async () => {
    throw Object.assign(new Error('role check should not run for canned responses'), { statusCode: 500 })
  }),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => state.session),
}))

vi.mock('~/server/utils/support-access', () => access)

vi.mock('~/server/utils/support-errors', () => ({
  isUniqueViolation: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505'),
}))

vi.mock('~/server/database/drizzle', () => {
  const nextRows = () => state.queuedRows.shift() ?? []

  const selectChain = () => {
    const rows = nextRows()
    const result = Promise.resolve(rows)
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => result,
      limit: () => result,
      then: (...args: Parameters<Promise<unknown[]>['then']>) => result.then(...args),
    }
    return chain
  }

  const insertChain = () => {
    const chain: Record<string, unknown> = {
      values: (values: Record<string, unknown>) => {
        state.insertedValues = values
        return chain
      },
      returning: () => Promise.resolve([{ id: 'response-1', ...state.insertedValues }]),
    }
    return chain
  }

  const updateChain = () => {
    const chain: Record<string, unknown> = {
      set: (values: Record<string, unknown>) => {
        state.updatedSet = values
        return chain
      },
      where: () => chain,
      returning: () => Promise.resolve([{ id: 'response-1', teamId: 'team-1', ...state.updatedSet }]),
    }
    return chain
  }

  const deleteChain = () => {
    const result = Promise.resolve([])
    const chain: Record<string, unknown> = {
      where: () => {
        state.deleteCalled = true
        return result
      },
    }
    return chain
  }

  return {
    db: {
      select: selectChain,
      insert: insertChain,
      update: updateChain,
      delete: deleteChain,
    },
  }
})

type Handler = EventHandler

const listHandler = await import('~/server/api/support/canned-responses/index.get')
  .then((module) => module.default as Handler)
  .catch(() => null)
const createHandler = await import('~/server/api/support/canned-responses/index.post')
  .then((module) => module.default as Handler)
  .catch(() => null)
const updateHandler = await import('~/server/api/support/canned-responses/[id].put')
  .then((module) => module.default as Handler)
  .catch(() => null)
const deleteHandler = await import('~/server/api/support/canned-responses/[id].delete')
  .then((module) => module.default as Handler)
  .catch(() => null)

function asEvent(value: unknown): Parameters<Handler>[0] {
  return value as Parameters<Handler>[0]
}

beforeEach(() => {
  state.body = {}
  state.params = { id: 'response-1' }
  state.query = { teamId: 'team-1' }
  state.queuedRows = []
  state.insertedValues = null
  state.updatedSet = null
  state.deleteCalled = false
  vi.clearAllMocks()
})

describe('support canned response routes', () => {
  it('lists team-scoped responses for an ordinary support agent', async () => {
    expect(listHandler).not.toBeNull()
    state.queuedRows = [
      [
        {
          id: 'response-1',
          teamId: 'team-1',
          shortcode: 'greet',
          title: 'Greeting',
          body: 'Hi {{contact.name}}',
        },
      ],
    ]

    const response = await listHandler!(asEvent({}))

    expect(access.requireTeamMembership).toHaveBeenCalledWith('team-1', 'user-1')
    expect(access.requireSupportTeamRole).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      success: true,
      data: { cannedResponses: [{ id: 'response-1', shortcode: 'greet' }] },
    })
  })

  it('creates a response without an inbox scope or role gate', async () => {
    expect(createHandler).not.toBeNull()
    state.body = {
      teamId: 'team-1',
      shortcode: 'greet',
      title: 'Friendly greeting',
      body: 'Hi {{contact.name}}, {{agent.name}} here.',
      inboxId: 'must-not-be-accepted',
    }

    await expect(createHandler!(asEvent({}))).rejects.toMatchObject({ statusCode: 400 })

    state.body = {
      teamId: 'team-1',
      shortcode: 'greet',
      title: 'Friendly greeting',
      body: 'Hi {{contact.name}}, {{agent.name}} here.',
    }

    const response = await createHandler!(asEvent({}))

    expect(access.requireTeamMembership).toHaveBeenCalledWith('team-1', 'user-1')
    expect(access.requireSupportTeamRole).not.toHaveBeenCalled()
    expect(state.insertedValues).toMatchObject({
      teamId: 'team-1',
      shortcode: 'greet',
      title: 'Friendly greeting',
      body: 'Hi {{contact.name}}, {{agent.name}} here.',
      createdByUserId: 'user-1',
    })
    expect(state.insertedValues).not.toHaveProperty('inboxId')
    expect(response).toMatchObject({ success: true, data: { cannedResponse: { shortcode: 'greet' } } })
  })

  it('updates only after resolving the existing response team', async () => {
    expect(updateHandler).not.toBeNull()
    state.queuedRows = [[{ id: 'response-1', teamId: 'team-2', shortcode: 'old', title: 'Old', body: 'Old body' }]]
    state.body = { title: 'Updated', body: 'Updated body' }

    const response = await updateHandler!(asEvent({}))

    expect(access.requireTeamMembership).toHaveBeenCalledWith('team-2', 'user-1')
    expect(access.requireSupportTeamRole).not.toHaveBeenCalled()
    expect(state.updatedSet).toMatchObject({ title: 'Updated', body: 'Updated body' })
    expect(state.updatedSet).not.toHaveProperty('teamId')
    expect(state.updatedSet).not.toHaveProperty('inboxId')
    expect(response).toMatchObject({ success: true, data: { cannedResponse: { title: 'Updated' } } })
  })

  it('deletes only after resolving the existing response team', async () => {
    expect(deleteHandler).not.toBeNull()
    state.queuedRows = [[{ id: 'response-1', teamId: 'team-2' }]]

    const response = await deleteHandler!(asEvent({}))

    expect(access.requireTeamMembership).toHaveBeenCalledWith('team-2', 'user-1')
    expect(access.requireSupportTeamRole).not.toHaveBeenCalled()
    expect(state.deleteCalled).toBe(true)
    expect(response).toMatchObject({ success: true, data: { deleted: true } })
  })
})
