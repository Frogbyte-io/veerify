import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1', teamId: 't1', settings: { marketingEnabled: true } } as Record<string, unknown>,
  moduleRow: [{ marketingEnabled: true }] as unknown[],
  adminResult: 'ok' as 'ok' | 'forbidden',
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(state.moduleRow) }) }),
    }),
  },
}))

vi.mock('~/server/utils/project-access', () => ({
  requireProjectAccess: vi.fn(async (projectId: string) => {
    if (projectId === 'missing') throw httpError(404, 'Not Found')
    if (projectId === 'foreign') throw httpError(403, 'Forbidden')
    return state.project
  }),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async () => {
    if (state.adminResult === 'forbidden') throw httpError(403, 'Forbidden')
    return { id: 'm1', role: 'admin' }
  }),
}))

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

const { requireMarketingAccess, requireMarketingAdmin } = await import('~/server/utils/marketing-access')

function messageOf(statusCode: number, message: string) {
  return expect.objectContaining({
    statusCode,
    data: expect.objectContaining({ error: expect.objectContaining({ message }) }),
  })
}

beforeEach(() => {
  state.project = { id: 'p1', teamId: 't1', settings: { marketingEnabled: true } }
  state.moduleRow = [{ marketingEnabled: true }]
  state.adminResult = 'ok'
})

describe('requireMarketingAccess', () => {
  it('returns the project and team when both switches are on', async () => {
    await expect(requireMarketingAccess('p1', 'u1')).resolves.toEqual({ project: state.project, teamId: 't1' })
  })

  it('propagates project 404 and non-member 403', async () => {
    await expect(requireMarketingAccess('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireMarketingAccess('foreign', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the team module is off', async () => {
    state.moduleRow = [{ marketingEnabled: false }]
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toEqual(
      messageOf(403, 'Marketing is not enabled for this team')
    )
  })

  it('treats a missing team settings row as the registry default (off)', async () => {
    state.moduleRow = []
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the product toggle is off or unset', async () => {
    state.project = { id: 'p1', teamId: 't1', settings: { marketingEnabled: false } }
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toEqual(
      messageOf(403, 'Marketing is not enabled for this product')
    )

    state.project = { id: 'p1', teamId: 't1', settings: null }
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('requireMarketingAdmin', () => {
  it('returns access for a team admin', async () => {
    await expect(requireMarketingAdmin('p1', 'u1')).resolves.toMatchObject({ teamId: 't1' })
  })

  it('rejects a non-admin member with 403', async () => {
    state.adminResult = 'forbidden'
    await expect(requireMarketingAdmin('p1', 'u1')).rejects.toEqual(
      messageOf(403, 'Only team admins can manage Marketing settings')
    )
  })

  it('still enforces the module switches for admins', async () => {
    state.moduleRow = [{ marketingEnabled: false }]
    await expect(requireMarketingAdmin('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
