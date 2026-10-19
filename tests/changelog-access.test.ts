import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1', teamId: 't1', settings: { changelogEnabled: true } } as Record<string, unknown>,
  moduleRow: [{ changelogEnabled: true }] as unknown[],
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

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

const { requireChangelogAccess } = await import('~/server/utils/changelog-access')

beforeEach(() => {
  state.project = { id: 'p1', teamId: 't1', settings: { changelogEnabled: true } }
  state.moduleRow = [{ changelogEnabled: true }]
})

describe('requireChangelogAccess', () => {
  it('returns the project and team when both switches are on', async () => {
    await expect(requireChangelogAccess('p1', 'u1')).resolves.toEqual({ project: state.project, teamId: 't1' })
  })

  it('propagates project 404 and non-member 403', async () => {
    await expect(requireChangelogAccess('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireChangelogAccess('foreign', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the team module is off', async () => {
    state.moduleRow = [{ changelogEnabled: false }]
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'Changelog is not enabled for this team' } },
    })
  })

  it('treats a missing team settings row as the registry default (off)', async () => {
    state.moduleRow = []
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the product toggle is off or unset', async () => {
    state.project = { id: 'p1', teamId: 't1', settings: { changelogEnabled: false } }
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'Changelog is not enabled for this product' } },
    })
    state.project = { id: 'p1', teamId: 't1', settings: null }
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
