import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1', organizationId: 'o1', settings: { marketingEnabled: true } } as Record<string, unknown>,
  role: 'member' as 'member' | 'admin',
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.mock('~/server/utils/project-access', () => ({
  requireProjectRole: vi.fn(async (projectId: string) => {
    if (projectId === 'missing') throw httpError(404, 'Not Found')
    if (projectId === 'foreign') throw httpError(403, 'Forbidden')
    return { project: state.project, role: state.role }
  }),
}))

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

const { requireMarketingAccess, requireMarketingAdmin, requireMarketingDataAdmin } =
  await import('~/server/utils/marketing-access')

function messageOf(statusCode: number, message: string) {
  return expect.objectContaining({
    statusCode,
    data: expect.objectContaining({ error: expect.objectContaining({ message }) }),
  })
}

beforeEach(() => {
  state.project = { id: 'p1', organizationId: 'o1', settings: { marketingEnabled: true } }
  state.role = 'member'
})

describe('requireMarketingAccess', () => {
  it('returns the project and organization for any member when marketing is on', async () => {
    await expect(requireMarketingAccess('p1', 'u1')).resolves.toMatchObject({
      project: state.project,
      organizationId: 'o1',
    })
  })

  it('propagates project 404 and non-member 403', async () => {
    await expect(requireMarketingAccess('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireMarketingAccess('foreign', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the project switch is off or unset', async () => {
    state.project = { id: 'p1', organizationId: 'o1', settings: { marketingEnabled: false } }
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toEqual(
      messageOf(403, 'Marketing is not enabled for this project')
    )
    state.project = { id: 'p1', organizationId: 'o1', settings: null }
    await expect(requireMarketingAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('requireMarketingAdmin', () => {
  it('returns access for a project admin', async () => {
    state.role = 'admin'
    await expect(requireMarketingAdmin('p1', 'u1')).resolves.toMatchObject({ organizationId: 'o1' })
  })

  it('rejects a non-admin member with 403', async () => {
    await expect(requireMarketingAdmin('p1', 'u1')).rejects.toEqual(
      messageOf(403, 'Only project admins can manage Marketing settings')
    )
  })

  it('still enforces the module switch for admins', async () => {
    state.role = 'admin'
    state.project = { id: 'p1', organizationId: 'o1', settings: {} }
    await expect(requireMarketingAdmin('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('requireMarketingDataAdmin', () => {
  it('works for admins while marketing is off', async () => {
    state.role = 'admin'
    state.project = { id: 'p1', organizationId: 'o1', settings: {} }
    await expect(requireMarketingDataAdmin('p1', 'u1')).resolves.toMatchObject({ organizationId: 'o1' })
  })

  it('rejects members', async () => {
    await expect(requireMarketingDataAdmin('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
