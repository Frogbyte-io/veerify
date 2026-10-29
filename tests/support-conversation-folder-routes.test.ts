import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  existing: {
    id: 'conversation-1',
    projectId: 'project-1',
    inboxId: 'inbox-1',
    contactId: 'contact-1',
    displayId: 7,
    status: 'open',
    subject: 'Hello',
    spamAt: null as Date | null,
    deletedAt: null as Date | null,
    behaviour: 'helpdesk',
    priority: null as string | null,
    slaPolicyId: null as string | null,
    firstResponseAt: null as Date | null,
  },
  sla: null as Record<string, unknown> | null,
  sets: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  published: [] as unknown[],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', () => 'conversation-1')
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'agent-1', name: 'Agent' } })),
}))
vi.mock('~/server/utils/support-access', () => ({
  requireConversationAccess: vi.fn(async () => state.existing),
  hasProjectAccess: vi.fn(async () => true),
}))
vi.mock('~/server/utils/support-realtime', () => ({
  publishConversationEvent: vi.fn(async (event: unknown) => void state.published.push(event)),
}))
vi.mock('~/server/utils/automation-engine', () => ({ triggerAutomationEvent: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/notifications', () => ({ notifyUser: vi.fn() }))
vi.mock('~/server/utils/sla-assignment', () => ({ resolveSlaAssignment: vi.fn(async () => state.sla) }))
vi.mock('~/server/database/drizzle', () => {
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.sets.push(values)
        return { where: () => ({ returning: async () => [{ ...state.existing, ...values }] }) }
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => void state.inserts.push(values),
    }),
  }
  // Contact and tag lookups for SLA assignment: every select resolves to no rows.
  const rows = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: async () => [],
      then: (resolve: (value: unknown[]) => unknown) => resolve([]),
    }
    return chain
  }
  return { db: { select: rows, transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

const handler = (await import('~/server/api/support/conversations/[id].patch')).default as EventHandler
const run = () => handler({} as Parameters<EventHandler>[0]) as Promise<{ data: { changed: boolean } }>

beforeEach(() => {
  state.body = {}
  state.existing.status = 'open'
  state.existing.spamAt = null
  state.existing.deletedAt = null
  state.existing.slaPolicyId = null
  state.sla = null
  state.sets = []
  state.inserts = []
  state.published = []
})

describe('PATCH /api/support/conversations/[id] folders', () => {
  it('rejects non-boolean spam and deleted values', async () => {
    state.body = { spam: 'yes' }
    await expect(run()).rejects.toMatchObject({ statusCode: 400 })
    state.body = { deleted: 1 }
    await expect(run()).rejects.toMatchObject({ statusCode: 400 })
    expect(state.sets).toEqual([])
  })

  it('moves a conversation to Spam without touching its status, and logs it', async () => {
    state.body = { spam: true }
    const result = await run()
    expect(result.data.changed).toBe(true)
    expect(state.sets[0]).toMatchObject({ spamAt: expect.any(Date) })
    expect(state.sets[0]).not.toHaveProperty('status')
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({ kind: 'activity', body: 'Marked as spam.', isPrivate: true })
    expect(state.published).toHaveLength(1)
  })

  it('moves to Trash and restores', async () => {
    state.body = { deleted: true }
    await run()
    expect(state.sets[0]).toMatchObject({ deletedAt: expect.any(Date) })
    expect(state.inserts[0]).toMatchObject({ body: expect.stringContaining('Moved to Trash') })

    state.sets = []
    state.existing.deletedAt = new Date()
    state.body = { deleted: false }
    await run()
    expect(state.sets[0]).toMatchObject({ deletedAt: null })
  })

  it('assigns an SLA when a conversation without one leaves Spam', async () => {
    state.existing.spamAt = new Date()
    state.sla = { slaPolicyId: 'policy-1', firstResponseDueAt: new Date() }
    state.body = { spam: false }
    await run()
    expect(state.sets[0]).toMatchObject({ spamAt: null, slaPolicyId: 'policy-1' })
  })

  it('keeps the existing SLA when a conversation that has one leaves Trash', async () => {
    state.existing.deletedAt = new Date()
    state.existing.slaPolicyId = 'policy-0'
    state.sla = { slaPolicyId: 'policy-1' }
    state.body = { deleted: false }
    await run()
    expect(state.sets[0]).toMatchObject({ deletedAt: null })
    expect(state.sets[0]).not.toHaveProperty('slaPolicyId')
  })

  it('is a no-op when the folder already matches', async () => {
    state.existing.spamAt = new Date()
    state.body = { spam: true }
    const result = await run()
    expect(result.data.changed).toBe(false)
    expect(state.sets).toEqual([])
    expect(state.published).toEqual([])
  })

  it('archives through the closed status', async () => {
    state.body = { status: 'closed' }
    await run()
    expect(state.sets[0]).toMatchObject({ status: 'closed' })
  })
})
