import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1', organizationId: 'o1', settings: { changelogEnabled: true } } as Record<string, unknown>,
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

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
  state.project = { id: 'p1', organizationId: 'o1', settings: { changelogEnabled: true } }
})

describe('requireChangelogAccess', () => {
  it('returns the project when the tool is switched on', async () => {
    await expect(requireChangelogAccess('p1', 'u1')).resolves.toEqual({ project: state.project })
  })

  it('propagates project 404 and no-access 403', async () => {
    await expect(requireChangelogAccess('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireChangelogAccess('foreign', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the project switch is off or unset (default off)', async () => {
    state.project = { id: 'p1', organizationId: 'o1', settings: { changelogEnabled: false } }
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'Changelog is not enabled for this project' } },
    })
    state.project = { id: 'p1', organizationId: 'o1', settings: null }
    await expect(requireChangelogAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
